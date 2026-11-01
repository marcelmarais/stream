use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct DetectedLocation {
    pub country: String,
    pub city: String,
}

/// Long enough for the user to answer the first permission prompt.
#[cfg(target_os = "macos")]
const DETECT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);

/// Gets the current city from Core Location. Runs off the main thread because
/// it blocks until Core Location, which lives on the main thread, replies.
#[cfg(target_os = "macos")]
#[tauri::command(async)]
pub fn detect_location(app: tauri::AppHandle) -> Result<DetectedLocation, String> {
    let (reply, result) = std::sync::mpsc::channel();

    app.run_on_main_thread(move || macos::start(reply))
        .map_err(|e| format!("Failed to start location detection: {}", e))?;

    result.recv_timeout(DETECT_TIMEOUT).unwrap_or_else(|_| {
        let _ = app.run_on_main_thread(macos::cancel);
        Err("Timed out detecting location".to_string())
    })
}

#[cfg(not(target_os = "macos"))]
#[tauri::command(async)]
pub fn detect_location() -> Result<DetectedLocation, String> {
    Err("Location detection is only available on macOS".to_string())
}

// CLGeocoder is deprecated, but its MapKit replacement needs macOS 26.
#[cfg(target_os = "macos")]
#[allow(deprecated)]
mod macos {
    use std::cell::RefCell;
    use std::sync::mpsc::Sender;

    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::{NSObject, ProtocolObject};
    use objc2::{define_class, msg_send, AnyThread, MainThreadMarker, MainThreadOnly};
    use objc2_core_location::{
        CLAuthorizationStatus, CLGeocoder, CLLocation, CLLocationManager,
        CLLocationManagerDelegate, CLPlacemark,
    };
    use objc2_foundation::{NSArray, NSError, NSLocale, NSObjectProtocol, NSString};

    use super::DetectedLocation;

    type DetectResult = Result<DetectedLocation, String>;

    /// A city only needs a rough fix, which comes back faster than a precise one.
    const ACCURACY_METERS: f64 = 1000.0;

    /// The detection in flight. Core Location only calls back while the manager
    /// and delegate are alive, and callers that arrive meanwhile share its result.
    struct Detection {
        manager: Retained<CLLocationManager>,
        _delegate: Retained<Delegate>,
        geocoder: Option<Retained<CLGeocoder>>,
        location_requested: bool,
        replies: Vec<Sender<DetectResult>>,
    }

    thread_local! {
        static DETECTION: RefCell<Option<Detection>> = const { RefCell::new(None) };
    }

    define_class!(
        #[unsafe(super(NSObject))]
        #[thread_kind = MainThreadOnly]
        struct Delegate;

        unsafe impl NSObjectProtocol for Delegate {}

        unsafe impl CLLocationManagerDelegate for Delegate {
            #[unsafe(method(locationManagerDidChangeAuthorization:))]
            fn did_change_authorization(&self, _manager: &CLLocationManager) {
                advance();
            }

            #[unsafe(method(locationManager:didUpdateLocations:))]
            fn did_update_locations(
                &self,
                _manager: &CLLocationManager,
                locations: &NSArray<CLLocation>,
            ) {
                match locations.lastObject() {
                    Some(location) => reverse_geocode(&location),
                    None => finish(Err("Core Location returned no position".to_string())),
                }
            }

            #[unsafe(method(locationManager:didFailWithError:))]
            fn did_fail(&self, _manager: &CLLocationManager, error: &NSError) {
                finish(Err(error.localizedDescription().to_string()));
            }
        }
    );

    impl Delegate {
        fn new(mtm: MainThreadMarker) -> Retained<Self> {
            unsafe { msg_send![Self::alloc(mtm), init] }
        }
    }

    pub fn start(reply: Sender<DetectResult>) {
        let Some(mtm) = MainThreadMarker::new() else {
            let _ = reply.send(Err("Not on the main thread".to_string()));
            return;
        };

        let reply = DETECTION.with_borrow_mut(|active| match active {
            Some(detection) => {
                detection.replies.push(reply);
                None
            }
            None => Some(reply),
        });
        let Some(reply) = reply else { return };

        if !unsafe { CLLocationManager::locationServicesEnabled_class() } {
            let _ = reply.send(Err("Location Services are turned off".to_string()));
            return;
        }

        let delegate = Delegate::new(mtm);
        let manager = unsafe { CLLocationManager::new() };
        unsafe {
            manager.setDelegate(Some(ProtocolObject::from_ref(&*delegate)));
            manager.setDesiredAccuracy(ACCURACY_METERS);
        }

        DETECTION.set(Some(Detection {
            manager,
            _delegate: delegate,
            geocoder: None,
            location_requested: false,
            replies: vec![reply],
        }));
        advance();
    }

    pub fn cancel() {
        finish(Err("Timed out detecting location".to_string()));
    }

    /// Moves on from wherever authorization stands. Runs at the start and again
    /// each time the status changes, including right after the delegate is set.
    fn advance() {
        let Some((manager, location_requested)) = DETECTION.with_borrow(|active| {
            active
                .as_ref()
                .map(|detection| (detection.manager.clone(), detection.location_requested))
        }) else {
            return;
        };

        match unsafe { manager.authorizationStatus() } {
            CLAuthorizationStatus::NotDetermined => unsafe {
                manager.requestWhenInUseAuthorization();
            },
            CLAuthorizationStatus::AuthorizedAlways
            | CLAuthorizationStatus::AuthorizedWhenInUse => {
                if !location_requested {
                    DETECTION.with_borrow_mut(|active| {
                        if let Some(detection) = active {
                            detection.location_requested = true;
                        }
                    });
                    unsafe { manager.requestLocation() };
                }
            }
            _ => finish(Err("Location permission denied".to_string())),
        }
    }

    fn reverse_geocode(location: &CLLocation) {
        let geocoder = unsafe { CLGeocoder::new() };
        DETECTION.with_borrow_mut(|active| {
            if let Some(detection) = active {
                detection.geocoder = Some(geocoder.clone());
            }
        });

        // Fixed so stored names stay in English whatever the system language is.
        let locale =
            NSLocale::initWithLocaleIdentifier(NSLocale::alloc(), &NSString::from_str("en_US"));

        let handler = RcBlock::new(
            |placemarks: *mut NSArray<CLPlacemark>, error: *mut NSError| {
                let placemark =
                    unsafe { placemarks.as_ref() }.and_then(|found| found.firstObject());

                finish(
                    placemark
                        .and_then(|place| place_name(&place))
                        .ok_or_else(|| {
                            unsafe { error.as_ref() }
                                .map(|error| error.localizedDescription().to_string())
                                .unwrap_or_else(|| "No city found for this position".to_string())
                        }),
                );
            },
        );

        unsafe {
            geocoder.reverseGeocodeLocation_preferredLocale_completionHandler(
                location,
                Some(&locale),
                RcBlock::as_ptr(&handler),
            );
        }
    }

    fn place_name(place: &CLPlacemark) -> Option<DetectedLocation> {
        let (city, country) = unsafe {
            (
                place.locality().or_else(|| place.subAdministrativeArea()),
                place.country(),
            )
        };

        Some(DetectedLocation {
            country: country?.to_string(),
            city: city?.to_string(),
        })
    }

    fn finish(result: DetectResult) {
        let Some(detection) = DETECTION.take() else {
            return;
        };

        for reply in detection.replies {
            let _ = reply.send(result.clone());
        }
    }
}
