//! Draws the tray icon: a cairn of stacked stones in the current urgency colour.
//!
//! The icon is drawn rather than shipped as files so one colour per urgency
//! level costs nothing, and the stack stays identical to the app icon.

use tauri::image::Image;

const SIZE: usize = 64;

/// Bottom to top: centre x, centre y, radius x, radius y. Gaps are wide enough
/// to survive being scaled down to 16px in the notification area.
const STONES: [(f32, f32, f32, f32); 4] = [
    (32.0, 52.0, 20.0, 5.0),
    (31.0, 39.0, 15.5, 4.5),
    (33.0, 27.0, 11.0, 4.0),
    (31.5, 16.0, 7.0, 3.5),
];

pub fn tray_icon(color: [u8; 3]) -> Image<'static> {
    let mut pixels = vec![0u8; SIZE * SIZE * 4];
    for &(cx, cy, rx, ry) in &STONES {
        ellipse(&mut pixels, cx, cy, rx, ry, color);
    }
    Image::new_owned(pixels, SIZE as u32, SIZE as u32)
}

/// Fills an ellipse with one pixel of feathering, composited source-over.
fn ellipse(pixels: &mut [u8], cx: f32, cy: f32, rx: f32, ry: f32, color: [u8; 3]) {
    let x0 = (cx - rx - 2.0).floor().max(0.0) as usize;
    let x1 = (cx + rx + 2.0).ceil().min(SIZE as f32 - 1.0) as usize;
    let y0 = (cy - ry - 2.0).floor().max(0.0) as usize;
    let y1 = (cy + ry + 2.0).ceil().min(SIZE as f32 - 1.0) as usize;

    for y in y0..=y1 {
        for x in x0..=x1 {
            let dx = (x as f32 + 0.5 - cx) / rx;
            let dy = (y as f32 + 0.5 - cy) / ry;
            // Distance to the edge in pixels, give or take; good enough to feather with.
            let distance = (dx * dx + dy * dy).sqrt().mul_add(rx.min(ry), -rx.min(ry));
            let alpha = (0.5 - distance).clamp(0.0, 1.0);
            if alpha <= 0.0 {
                continue;
            }
            let i = (y * SIZE + x) * 4;
            let dst_a = pixels[i + 3] as f32 / 255.0;
            let out_a = alpha + dst_a * (1.0 - alpha);
            for c in 0..3 {
                let src = color[c] as f32 / 255.0;
                let dst = pixels[i + c] as f32 / 255.0;
                let blended = (src * alpha + dst * dst_a * (1.0 - alpha)) / out_a.max(1e-6);
                pixels[i + c] = (blended * 255.0).round() as u8;
            }
            pixels[i + 3] = (out_a * 255.0).round() as u8;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RED: [u8; 3] = [0xd9, 0x30, 0x25];

    fn pixel(image: &Image<'_>, x: usize, y: usize) -> [u8; 4] {
        let rgba = image.rgba();
        let i = (y * SIZE + x) * 4;
        [rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]]
    }

    #[test]
    fn is_a_square_rgba_image() {
        let image = tray_icon(RED);
        assert_eq!((image.width(), image.height()), (SIZE as u32, SIZE as u32));
        assert_eq!(image.rgba().len(), SIZE * SIZE * 4);
    }

    #[test]
    fn draws_each_stone_in_the_given_colour() {
        let image = tray_icon(RED);
        for (i, &(cx, cy, _, _)) in STONES.iter().enumerate() {
            let p = pixel(&image, cx as usize, cy as usize);
            assert_eq!([p[0], p[1], p[2]], RED, "stone {i} has the wrong colour");
            assert_eq!(p[3], 255, "stone {i} is not opaque at its centre");
        }
    }

    #[test]
    fn leaves_the_background_and_the_gaps_clear() {
        let image = tray_icon(RED);
        for (x, y) in [(0, 0), (SIZE - 1, 0), (0, SIZE - 1), (SIZE - 1, SIZE - 1)] {
            assert_eq!(pixel(&image, x, y)[3], 0, "corner ({x}, {y}) is not transparent");
        }
        // Midway between two stones: the stack has to read as separate stones
        // once Windows scales this down to 16px.
        let gap = ((STONES[0].1 - STONES[0].3) + (STONES[1].1 + STONES[1].3)) / 2.0;
        assert_eq!(pixel(&image, 32, gap as usize)[3], 0, "no gap between the bottom two stones");
    }

    #[test]
    fn every_urgency_level_draws_something() {
        for level in ["overdue", "soon", "today", "week", "later", "done", "nonsense"] {
            let image = tray_icon(crate::urgency::color_for(level));
            let lit = image.rgba().chunks(4).filter(|p| p[3] > 0).count();
            assert!(lit > 200, "{level} drew almost nothing ({lit} pixels)");
        }
    }
}
