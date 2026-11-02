import { WidgetType } from "@codemirror/view";
import { openUrl } from "@tauri-apps/plugin-opener";

const SVG_NS = "http://www.w3.org/2000/svg";

// The schemes the opener plugin's default scope lets us hand to the OS
const OPENABLE_URL = /^(?:https?|mailto|tel):/i;
const EMAIL = /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/;
const IP_ADDRESS = /^(?:\d{1,3}(?:\.\d{1,3}){3}|\[[\da-f:.]+\])$/i;

// Phosphor's regular Globe and EnvelopeSimple, matching the rest of the app
const GLOBE_PATH =
  "M128,24h0A104,104,0,1,0,232,128,104.12,104.12,0,0,0,128,24Zm88,104a87.61,87.61,0,0,1-3.33,24H174.16a157.44,157.44,0,0,0,0-48h38.51A87.61,87.61,0,0,1,216,128ZM102,168H154a115.11,115.11,0,0,1-26,45A115.27,115.27,0,0,1,102,168Zm-3.9-16a140.84,140.84,0,0,1,0-48h59.88a140.84,140.84,0,0,1,0,48ZM40,128a87.61,87.61,0,0,1,3.33-24H81.84a157.44,157.44,0,0,0,0,48H43.33A87.61,87.61,0,0,1,40,128ZM154,88H102a115.11,115.11,0,0,1,26-45A115.27,115.27,0,0,1,154,88Zm52.33,0H170.71a135.28,135.28,0,0,0-22.3-45.6A88.29,88.29,0,0,1,206.37,88ZM107.59,42.4A135.28,135.28,0,0,0,85.29,88H49.63A88.29,88.29,0,0,1,107.59,42.4ZM49.63,168H85.29a135.28,135.28,0,0,0,22.3,45.6A88.29,88.29,0,0,1,49.63,168Zm98.78,45.6a135.28,135.28,0,0,0,22.3-45.6h35.66A88.29,88.29,0,0,1,148.41,213.6Z";
const ENVELOPE_PATH =
  "M224,48H32a8,8,0,0,0-8,8V192a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V56A8,8,0,0,0,224,48ZM203.43,64,128,133.15,52.57,64ZM216,192H40V74.19l82.59,75.71a8,8,0,0,0,10.82,0L216,74.19V192Z";

function safeDecode(text: string) {
  try {
    return decodeURI(text);
  } catch {
    return text;
  }
}

/**
 * The URL to open for a link's target, or null when the OS can't open it
 * (relative paths, custom schemes).
 */
export function linkHref(target: string) {
  const text = target.trim();

  if (OPENABLE_URL.test(text)) {
    return text;
  }

  if (/^www\./i.test(text)) {
    return `https://${text}`;
  }

  if (EMAIL.test(text)) {
    return `mailto:${text}`;
  }

  return null;
}

/** `https://www.github.com/a/b?c` reads as `github.com/a/b?c` */
export function linkLabel(href: string) {
  try {
    const url = new URL(href);

    if (url.protocol === "mailto:" || url.protocol === "tel:") {
      return safeDecode(url.pathname);
    }

    const path = url.pathname === "/" ? "" : url.pathname;

    return safeDecode(
      `${url.host.replace(/^www\./, "")}${path}${url.search}${url.hash}`,
    );
  } catch {
    return href;
  }
}

/** Public hosts only, so local and private addresses aren't sent anywhere */
function publicHost(href: string) {
  try {
    const { protocol, hostname } = new URL(href);

    if (
      !/^https?:$/.test(protocol) ||
      !hostname.includes(".") ||
      IP_ADDRESS.test(hostname) ||
      hostname.endsWith(".local")
    ) {
      return null;
    }

    return hostname;
  } catch {
    return null;
  }
}

// Google answers unknown hosts with a generic 16px globe, and a 404 status
// that an <img> can't see, so only larger icons count as real ones
const GOOGLE_PLACEHOLDER_SIZE = 16;

function googleFavicon(domain: string) {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`;
}

/** `travelperk.legalos.io` -> `legalos.io`, or null when there's no parent */
function parentDomain(hostname: string) {
  const labels = hostname.replace(/^www\./, "").split(".");

  return labels.length > 2 ? labels.slice(-2).join(".") : null;
}

/** Icons to try for a host, best first. Google's come first as they're cached */
function faviconCandidates(hostname: string) {
  const parent = parentDomain(hostname);

  return [
    { src: googleFavicon(hostname), google: true },
    { src: `https://${hostname}/favicon.ico`, google: false },
    ...(parent ? [{ src: googleFavicon(parent), google: true }] : []),
  ];
}

// Per host for the session: the icon that worked, or null once none did
const resolvedFavicons = new Map<string, string | null>();
const pendingFavicons = new Map<string, Promise<string | null>>();

function loads(src: string, google: boolean) {
  return new Promise<boolean>((resolve) => {
    const probe = new Image();
    probe.referrerPolicy = "no-referrer";
    probe.onload = () =>
      resolve(!google || probe.naturalWidth > GOOGLE_PLACEHOLDER_SIZE);
    probe.onerror = () => resolve(false);
    probe.src = src;
  });
}

function resolveFavicon(hostname: string) {
  const known = resolvedFavicons.get(hostname);

  if (known !== undefined) {
    return Promise.resolve(known);
  }

  let pending = pendingFavicons.get(hostname);

  if (!pending) {
    pending = (async () => {
      for (const { src, google } of faviconCandidates(hostname)) {
        if (await loads(src, google)) {
          return src;
        }
      }

      return null;
    })().then((src) => {
      resolvedFavicons.set(hostname, src);
      pendingFavicons.delete(hostname);

      return src;
    });
    pendingFavicons.set(hostname, pending);
  }

  return pending;
}

function glyph(path: string) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "cm-note-link-icon");
  svg.setAttribute("viewBox", "0 0 256 256");
  svg.setAttribute("aria-hidden", "true");

  const shape = document.createElementNS(SVG_NS, "path");
  shape.setAttribute("d", path);
  svg.append(shape);

  return svg;
}

function linkIcon(href: string) {
  if (href.toLowerCase().startsWith("mailto:")) {
    return glyph(ENVELOPE_PATH);
  }

  const hostname = publicHost(href);
  const fallback = glyph(GLOBE_PATH);

  if (!hostname) {
    return fallback;
  }

  // The globe holds the icon's place, so the chip keeps its size while the
  // candidates load and the real icon swaps in only once one has
  resolveFavicon(hostname).then((src) => {
    if (!src) {
      return;
    }

    const image = document.createElement("img");
    image.className = "cm-note-link-icon";
    image.alt = "";
    image.draggable = false;
    image.referrerPolicy = "no-referrer";
    image.src = src;
    fallback.replaceWith(image);
  });

  return fallback;
}

function openLink(href: string) {
  openUrl(href).catch((error) => {
    console.error("Failed to open link:", error);
  });
}

/**
 * A link collapsed to its favicon and a truncated label. Clicking opens it in
 * the default browser; the markdown comes back when the cursor reaches it.
 */
export class LinkChipWidget extends WidgetType {
  constructor(
    readonly href: string,
    readonly label: string,
  ) {
    super();
  }

  eq(other: LinkChipWidget) {
    return other.href === this.href && other.label === this.label;
  }

  toDOM() {
    const chip = document.createElement("span");
    chip.className = "cm-note-link-chip";
    chip.title = this.href;
    chip.setAttribute("role", "link");
    chip.append(linkIcon(this.href), this.label);

    // Keep the caret where it is, so the chip doesn't turn back into markdown
    chip.addEventListener("mousedown", (event) => {
      if (event.button === 0) {
        event.preventDefault();
      }
    });
    chip.addEventListener("click", (event) => {
      event.preventDefault();
      openLink(this.href);
    });

    return chip;
  }

  ignoreEvent() {
    return true;
  }
}
