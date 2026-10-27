import { WIDGET_LINKS, type WidgetData, type WidgetRow } from '@cairn/ui'
import { FlexWidget, TextWidget, type ColorProp } from 'react-native-android-widget'
import type { Palette } from '../theme'

/** The widget's name in app.json, and in every update request. */
export const TODAY_WIDGET = 'Today'

/** What a tap on a row's circle sends to the widget task: complete it, without opening the app. */
export const COMPLETE = 'COMPLETE'

const hex = (color: string) => color as ColorProp

/**
 * Today on the home screen: what is late, due soon or due today, most urgent
 * first, in the app's own colours. A strip and a circle in the urgency's
 * colour, its symbol beside the time so it reads without colour, and the
 * class's colour down the far edge for coursework.
 */
export function TodayWidget({ data, colors, wide }: { data: WidgetData; colors: Palette; wide: boolean }) {
  const counts = [data.classroom ? `${data.classroom} Classroom` : '', data.mail ? `${data.mail} mail` : ''].filter(Boolean).join(' · ')
  return (
    <FlexWidget
      style={{ height: 'match_parent', width: 'match_parent', flexDirection: 'column', backgroundColor: hex(colors.bg), borderRadius: 22, padding: 12 }}
      accessibilityLabel="Cairn, due today"
    >
      <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
        <TextWidget
          text="Today"
          style={{ fontSize: 17, fontWeight: '700', color: hex(colors.fg) }}
          clickAction="OPEN_URI"
          clickActionData={{ uri: WIDGET_LINKS.tasks }}
        />
        <FlexWidget style={{ flex: 1 }} />
        {wide && counts ? (
          <TextWidget
            text={counts}
            style={{ fontSize: 12, color: hex(colors.muted), marginRight: 10 }}
            clickAction="OPEN_URI"
            clickActionData={{ uri: data.classroom ? WIDGET_LINKS.classroom : WIDGET_LINKS.inbox }}
          />
        ) : null}
        <FlexWidget
          style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: hex(colors.accent), alignItems: 'center', justifyContent: 'center' }}
          clickAction="OPEN_URI"
          clickActionData={{ uri: WIDGET_LINKS.capture }}
          accessibilityLabel="New task"
        >
          <TextWidget text="+" style={{ fontSize: 20, fontWeight: '700', color: hex(colors.onAccent) }} />
        </FlexWidget>
      </FlexWidget>

      {data.rows.map((row) => (
        <Row key={row.id} row={row} colors={colors} />
      ))}

      {data.empty ? (
        <TextWidget text={data.empty} style={{ fontSize: 14, color: hex(colors.muted), marginTop: 8 }} maxLines={3} truncate="END" />
      ) : null}
      {data.more > 0 ? (
        <TextWidget
          text={`${data.more} more due today`}
          style={{ fontSize: 13, color: hex(colors.muted), marginTop: 4, marginLeft: 4 }}
          clickAction="OPEN_URI"
          clickActionData={{ uri: WIDGET_LINKS.tasks }}
        />
      ) : null}
    </FlexWidget>
  )
}

function Row({ row, colors }: { row: WidgetRow; colors: Palette }) {
  // Late and due-soon say so in words as well; the rest only need the time.
  const cue = row.urgency === 'overdue' || row.urgency === 'soon' ? `${row.symbol} ${row.label} · ` : ''
  return (
    <FlexWidget
      style={{
        width: 'match_parent',
        height: 40,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: hex(colors.surface),
        borderRadius: 12,
        marginBottom: 4,
        overflow: 'hidden',
      }}
      clickAction="OPEN_URI"
      clickActionData={{ uri: WIDGET_LINKS.task(row.id) }}
      accessibilityLabel={`${row.title}, ${row.label}, ${row.when}`}
    >
      <FlexWidget style={{ width: 4, height: 'match_parent', backgroundColor: hex(row.color) }} />
      <FlexWidget
        style={{ width: 40, height: 'match_parent', alignItems: 'center', justifyContent: 'center' }}
        clickAction={COMPLETE}
        clickActionData={{ id: row.id }}
        accessibilityLabel={`Complete ${row.title}`}
      >
        <FlexWidget style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: hex(row.color) }} />
      </FlexWidget>
      <FlexWidget style={{ flex: 1, flexDirection: 'column', paddingRight: 8 }}>
        <TextWidget text={row.title} style={{ fontSize: 14, fontWeight: '600', color: hex(colors.fg) }} maxLines={1} truncate="END" />
        <TextWidget
          text={`${cue}${row.when}`}
          style={{ fontSize: 12, color: hex(row.urgency === 'overdue' ? row.color : colors.muted) }}
          maxLines={1}
          truncate="END"
        />
      </FlexWidget>
      {row.course ? <FlexWidget style={{ width: 4, height: 'match_parent', backgroundColor: hex(row.course) }} /> : null}
    </FlexWidget>
  )
}
