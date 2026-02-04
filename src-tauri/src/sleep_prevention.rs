//! macOS sleep prevention using IOKit power assertions
//!
//! Prevents idle sleep while monitors are running to ensure uninterrupted monitoring.

use std::sync::Mutex;

/// IOKit type aliases for FFI
#[cfg(target_os = "macos")]
type IOPMAssertionID = u32;

#[cfg(target_os = "macos")]
type IOReturn = i32;

#[cfg(target_os = "macos")]
type CFStringRef = *const std::ffi::c_void;

#[cfg(target_os = "macos")]
const IORETURN_SUCCESS: IOReturn = 0;

#[cfg(target_os = "macos")]
#[link(name = "IOKit", kind = "framework")]
extern "C" {
    fn IOPMAssertionCreateWithName(
        assertion_type: CFStringRef,
        assertion_level: u32,
        assertion_name: CFStringRef,
        assertion_id: *mut IOPMAssertionID,
    ) -> IOReturn;

    fn IOPMAssertionRelease(assertion_id: IOPMAssertionID) -> IOReturn;
}

/// Global state for sleep assertion
static SLEEP_ASSERTION_ID: Mutex<Option<u32>> = Mutex::new(None);

/// Prevent system idle sleep (macOS only)
///
/// Creates an IOKit power assertion that prevents the system from
/// sleeping due to idle activity. User-initiated sleep and scheduled
/// sleep are still allowed.
#[cfg(target_os = "macos")]
pub fn prevent_sleep() -> Result<(), String> {
    use core_foundation::base::TCFType;
    use core_foundation::string::CFString;

    let mut assertion_id_guard = SLEEP_ASSERTION_ID
        .lock()
        .map_err(|e| format!("Failed to lock assertion mutex: {}", e))?;

    // Already preventing sleep
    if assertion_id_guard.is_some() {
        return Ok(());
    }

    // Create CFString for assertion type (kIOPMAssertionTypeNoIdleSleep)
    let assertion_type = CFString::new("NoIdleSleepAssertion");
    let assertion_name = CFString::new("Clanker Spanker PR Monitor Active");

    let mut assertion_id: IOPMAssertionID = 0;

    // kIOPMAssertionLevelOn = 255
    let result = unsafe {
        IOPMAssertionCreateWithName(
            assertion_type.as_concrete_TypeRef() as CFStringRef,
            255, // kIOPMAssertionLevelOn
            assertion_name.as_concrete_TypeRef() as CFStringRef,
            &mut assertion_id,
        )
    };

    if result == IORETURN_SUCCESS {
        *assertion_id_guard = Some(assertion_id);
        println!("Sleep prevention enabled (assertion ID: {})", assertion_id);
        Ok(())
    } else {
        Err(format!(
            "Failed to create sleep assertion, error code: {}",
            result
        ))
    }
}

/// Allow system to sleep normally (macOS only)
///
/// Releases the power assertion, allowing the system to sleep
/// when idle again.
#[cfg(target_os = "macos")]
pub fn allow_sleep() -> Result<(), String> {
    let mut assertion_id_guard = SLEEP_ASSERTION_ID
        .lock()
        .map_err(|e| format!("Failed to lock assertion mutex: {}", e))?;

    if let Some(assertion_id) = assertion_id_guard.take() {
        let result = unsafe { IOPMAssertionRelease(assertion_id) };

        if result == IORETURN_SUCCESS {
            println!(
                "Sleep prevention disabled (released assertion ID: {})",
                assertion_id
            );
            Ok(())
        } else {
            // Put it back if release failed
            *assertion_id_guard = Some(assertion_id);
            Err(format!(
                "Failed to release sleep assertion, error code: {}",
                result
            ))
        }
    } else {
        // Not currently preventing sleep
        Ok(())
    }
}

/// Check if sleep is currently being prevented
pub fn is_sleep_prevented() -> bool {
    SLEEP_ASSERTION_ID
        .lock()
        .map(|guard| guard.is_some())
        .unwrap_or(false)
}

// Non-macOS stubs
#[cfg(not(target_os = "macos"))]
pub fn prevent_sleep() -> Result<(), String> {
    Ok(()) // No-op on non-macOS
}

#[cfg(not(target_os = "macos"))]
pub fn allow_sleep() -> Result<(), String> {
    Ok(()) // No-op on non-macOS
}

/// Update sleep prevention based on active monitor count and user setting
pub fn update_sleep_state(active_monitors: i32, feature_enabled: bool) {
    if feature_enabled && active_monitors > 0 {
        if let Err(e) = prevent_sleep() {
            eprintln!("Warning: Failed to prevent sleep: {}", e);
        }
    } else {
        if let Err(e) = allow_sleep() {
            eprintln!("Warning: Failed to allow sleep: {}", e);
        }
    }
}
