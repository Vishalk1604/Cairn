//! Tray colours for the urgency scale.
//!
//! These mirror `URGENCY` in `packages/ui/src/tokens.ts`. They are duplicated
//! rather than generated because the tray needs them before any JavaScript
//! runs; `apps/desktop/test/trayColors.test.ts` fails if the two drift apart.

pub type Rgb = [u8; 3];

pub const OVERDUE: Rgb = [0xd9, 0x30, 0x25];
pub const SOON: Rgb = [0xf2, 0x99, 0x00];
pub const TODAY: Rgb = [0xe3, 0xb5, 0x05];
pub const WEEK: Rgb = [0x1a, 0x73, 0xe8];
pub const LATER: Rgb = [0x80, 0x86, 0x8b];
pub const DONE: Rgb = [0x18, 0x80, 0x38];

/// Nothing to show. Mid grey stays legible on both light and dark taskbars.
pub const IDLE: Rgb = LATER;

pub fn color_for(level: &str) -> Rgb {
    match level {
        "overdue" => OVERDUE,
        "soon" => SOON,
        "today" => TODAY,
        "week" => WEEK,
        "done" => DONE,
        "later" => LATER,
        _ => IDLE,
    }
}
