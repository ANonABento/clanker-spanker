//! macOS dock badge functionality

/// Set the dock badge count on macOS
/// Must dispatch to main thread since AppKit calls are not thread-safe
#[cfg(target_os = "macos")]
pub fn set_dock_badge(count: Option<i32>) {
    use dispatch::Queue;

    // Dispatch to main queue to ensure we're on the main thread
    Queue::main().exec_async(move || {
        set_dock_badge_inner(count);
    });
}

/// Inner implementation that must run on main thread
#[cfg(target_os = "macos")]
fn set_dock_badge_inner(count: Option<i32>) {
    use cocoa::appkit::NSApp;
    use cocoa::base::nil;
    use cocoa::foundation::NSString;
    use objc::runtime::Object;

    unsafe {
        let app: *mut Object = NSApp();
        let dock_tile: *mut Object = objc::msg_send![app, dockTile];

        let badge_label: *mut Object = match count {
            Some(n) if n > 0 => NSString::alloc(nil).init_str(&n.to_string()),
            _ => nil,
        };

        let _: () = objc::msg_send![dock_tile, setBadgeLabel: badge_label];
    }
}

/// No-op on non-macOS platforms
#[cfg(not(target_os = "macos"))]
pub fn set_dock_badge(_count: Option<i32>) {
    // No-op
}
