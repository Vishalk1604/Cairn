import { StyleSheet, Text, View } from 'react-native'

/**
 * Icons drawn from plain views. Android's font has no folder, microphone or
 * picture glyphs, and the emoji stand-ins arrive in full colour, which shouts
 * on a dark screen. Drawn, they take any colour and stay crisp at any density.
 */

export function MicIcon({ color, size = 22 }: { color: string; size?: number }) {
  const s = size / 22
  return (
    <View style={{ width: size, height: size, alignItems: 'center' }}>
      <View style={{ width: 8 * s, height: 13 * s, borderRadius: 4 * s, borderWidth: 2 * s, borderColor: color, marginTop: 1 * s }} />
      <View
        style={{
          position: 'absolute',
          top: 7 * s,
          width: 14 * s,
          height: 9 * s,
          borderBottomLeftRadius: 7 * s,
          borderBottomRightRadius: 7 * s,
          borderWidth: 2 * s,
          borderTopWidth: 0,
          borderColor: color,
        }}
      />
      <View style={{ position: 'absolute', top: 16 * s, width: 2 * s, height: 4 * s, backgroundColor: color }} />
    </View>
  )
}

export function ImageIcon({ color, size = 22 }: { color: string; size?: number }) {
  const s = size / 22
  return (
    <View style={{ width: size, height: size, justifyContent: 'center', alignItems: 'center' }}>
      <View style={{ width: 19 * s, height: 16 * s, borderRadius: 3 * s, borderWidth: 2 * s, borderColor: color, overflow: 'hidden' }}>
        <View style={{ position: 'absolute', top: 2.5 * s, right: 3 * s, width: 4 * s, height: 4 * s, borderRadius: 2 * s, backgroundColor: color }} />
        <View
          style={{
            position: 'absolute',
            bottom: -6 * s,
            left: -1 * s,
            width: 12 * s,
            height: 12 * s,
            borderWidth: 2 * s,
            borderColor: color,
            transform: [{ rotate: '45deg' }],
          }}
        />
      </View>
    </View>
  )
}

export function CameraIcon({ color, size = 22 }: { color: string; size?: number }) {
  const s = size / 22
  return (
    <View style={{ width: size, height: size, justifyContent: 'center', alignItems: 'center' }}>
      <View style={{ position: 'absolute', top: 3 * s, width: 8 * s, height: 4 * s, borderTopLeftRadius: 2 * s, borderTopRightRadius: 2 * s, backgroundColor: color }} />
      <View style={{ width: 20 * s, height: 14 * s, marginTop: 4 * s, borderRadius: 3 * s, borderWidth: 2 * s, borderColor: color, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: 7 * s, height: 7 * s, borderRadius: 4 * s, borderWidth: 2 * s, borderColor: color }} />
      </View>
    </View>
  )
}

export function FolderIcon({ color, size = 22 }: { color: string; size?: number }) {
  const s = size / 22
  return (
    <View style={{ width: size, height: size, justifyContent: 'center' }}>
      <View style={{ position: 'absolute', left: 1 * s, top: 3 * s, width: 9 * s, height: 5 * s, borderTopLeftRadius: 2 * s, borderTopRightRadius: 2 * s, borderWidth: 2 * s, borderBottomWidth: 0, borderColor: color }} />
      <View style={{ position: 'absolute', left: 1 * s, top: 6 * s, width: 20 * s, height: 13 * s, borderRadius: 3 * s, borderWidth: 2 * s, borderColor: color }} />
    </View>
  )
}

/** Two corners pulling apart: the shape every photo app uses for resize. */
export function ResizeIcon({ color, size = 22 }: { color: string; size?: number }) {
  const s = size / 22
  const corner = { position: 'absolute' as const, width: 7 * s, height: 7 * s, borderColor: color }
  return (
    <View style={{ width: size, height: size }}>
      <View style={{ position: 'absolute', left: 2 * s, top: 2 * s, right: 2 * s, bottom: 2 * s, borderRadius: 3 * s, borderWidth: 1.5 * s, borderColor: color, opacity: 0.45 }} />
      <View style={[corner, { left: 5 * s, top: 5 * s, borderLeftWidth: 2 * s, borderTopWidth: 2 * s }]} />
      <View style={[corner, { right: 5 * s, bottom: 5 * s, borderRightWidth: 2 * s, borderBottomWidth: 2 * s }]} />
      <View
        style={{ position: 'absolute', left: 6 * s, top: 10 * s, width: 10 * s, height: 2 * s, backgroundColor: color, transform: [{ rotate: '45deg' }] }}
      />
    </View>
  )
}

export function TrashIcon({ color, size = 22 }: { color: string; size?: number }) {
  const s = size / 22
  return (
    <View style={{ width: size, height: size, alignItems: 'center' }}>
      <View style={{ marginTop: 2 * s, width: 6 * s, height: 3 * s, borderTopLeftRadius: 2 * s, borderTopRightRadius: 2 * s, borderWidth: 2 * s, borderBottomWidth: 0, borderColor: color }} />
      <View style={{ width: 18 * s, height: 2 * s, backgroundColor: color }} />
      <View
        style={{
          width: 14 * s,
          height: 13 * s,
          marginTop: 1 * s,
          borderBottomLeftRadius: 3 * s,
          borderBottomRightRadius: 3 * s,
          borderWidth: 2 * s,
          borderTopWidth: 0,
          borderColor: color,
          flexDirection: 'row',
          justifyContent: 'center',
          gap: 3 * s,
          paddingTop: 2 * s,
        }}
      >
        <View style={{ width: 1.5 * s, height: 7 * s, backgroundColor: color }} />
        <View style={{ width: 1.5 * s, height: 7 * s, backgroundColor: color }} />
      </View>
    </View>
  )
}

export function MailIcon({ color, size = 22 }: { color: string; size?: number }) {
  const s = size / 22
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: 20 * s, height: 15 * s, borderRadius: 3 * s, borderWidth: 2 * s, borderColor: color, overflow: 'hidden', alignItems: 'center' }}>
        <View
          style={{
            width: 13 * s,
            height: 13 * s,
            marginTop: -8 * s,
            borderWidth: 2 * s,
            borderColor: color,
            transform: [{ rotate: '45deg' }],
          }}
        />
      </View>
    </View>
  )
}

/** A push pin, leaning the way Xiaomi's does. */
export function PinIcon({ color, size = 18, filled }: { color: string; size?: number; filled?: boolean }) {
  const s = size / 18
  return (
    <View style={{ width: size, height: size, transform: [{ rotate: '35deg' }], alignItems: 'center' }}>
      <View style={{ width: 9 * s, height: 3 * s, borderRadius: 1 * s, backgroundColor: color }} />
      <View
        style={{
          width: 6 * s,
          height: 6 * s,
          borderWidth: 1.8 * s,
          borderTopWidth: 0,
          borderColor: color,
          backgroundColor: filled ? color : 'transparent',
        }}
      />
      <View style={{ width: 12 * s, height: 2 * s, borderRadius: 1 * s, backgroundColor: color }} />
      <View style={{ width: 1.8 * s, height: 5 * s, backgroundColor: color }} />
    </View>
  )
}

export function GearIcon({ color, size = 22 }: { color: string; size?: number }) {
  const s = size / 22
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View style={[styles.hex, { width: 18 * s, height: 18 * s, borderWidth: 2 * s, borderColor: color, borderRadius: 5 * s }]} />
      <View style={{ position: 'absolute', width: 7 * s, height: 7 * s, borderRadius: 4 * s, borderWidth: 2 * s, borderColor: color }} />
    </View>
  )
}

/** Any character the font does have, sized and centred like the drawn ones. */
export function Glyph({ char, color, size = 22, weight = '400' }: { char: string; color: string; size?: number; weight?: '400' | '600' | '700' }) {
  return (
    <View style={{ width: size + 4, height: size + 4, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color, fontSize: size, lineHeight: size + 4, fontWeight: weight, includeFontPadding: false }}>{char}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  hex: { transform: [{ rotate: '45deg' }] },
})
