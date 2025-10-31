interface BrowseLayoutProps {
  children: React.ReactNode;
}

export default function BrowseLayout({ children }: BrowseLayoutProps) {
  return (
    <div className="flex h-screen flex-col overflow-hidden rounded-lg bg-background">
      {children}
    </div>
  );
}
