# Design System: NexusHub — Smart Team Collaboration

## 1. Visual Theme & Atmosphere

**Mood:** Deep-space command center — an enterprise-grade SaaS interface that feels like piloting a spacecraft. The UI is dense with information but never cluttered, using the darkness as negative space to let glowing accents breathe. Every surface has a sense of depth through layered transparency and sharp, intentional borders.

**Aesthetic Philosophy:** Neo-brutal dark premium. Sharp geometric edges, zero softness. The system rejects rounded-corner friendliness in favor of precision-cut containers that convey authority and control. Color is used surgically — as status signals, not decoration.

---

## 2. Color Palette & Roles

| Token | Hex | Role |
|---|---|---|
| `--bg-abyss` | `#070A0F` | Root page background — the deepest void |
| `--bg-sidebar` | `#0B1220` | Sidebar and navigation rails |
| `--bg-panel` | `#0E1628` | Content panels, cards, modals |
| `--bg-elevated` | `#121E32` | Elevated surfaces, hover states, dropdowns |
| `--border-subtle` | `#1B2A3A` | Panel borders, dividers, separators |
| `--border-focus` | `#2A3F55` | Focus rings, active borders |
| `--accent-primary` | `#7C5CFF` | Primary CTA, active states, selection highlights |
| `--accent-primary-hover` | `#9B7FFF` | Primary hover glow |
| `--accent-secondary` | `#00D4FF` | Online indicators, links, info badges |
| `--accent-success` | `#00E676` | Completed tasks, success toasts |
| `--accent-warning` | `#FFB300` | Pending items, warning states |
| `--accent-danger` | `#FF3D71` | Errors, destructive actions, urgent badges |
| `--text-primary` | `#E6EAF2` | Headlines, body text, primary content |
| `--text-muted` | `#8B93A7` | Timestamps, metadata, secondary labels |
| `--text-disabled` | `#4A5268` | Disabled inputs, placeholder text |

---

## 3. Typography Rules

- **Font Family:** `Inter` — loaded from Google Fonts (weights 400, 500, 600, 700)
- **Headlines (h1–h3):** Weight 700, letter-spacing `-0.02em`, size scale `2rem → 1.25rem`
- **Body Text:** Weight 400, `0.875rem` (14px), line-height `1.5`
- **Labels & Metadata:** Weight 500, `0.75rem` (12px), uppercase with `0.08em` tracking
- **Monospace (code/IDs):** `JetBrains Mono`, weight 400, `0.8125rem`

---

## 4. Component Stylings

### Buttons
- **Shape:** Sharp squared-off edges (`border-radius: 4px`)
- **Primary:** `--accent-primary` background, white text, 2px solid matching border
- **Ghost:** Transparent background, `--text-muted` text, `--border-subtle` border on hover
- **Danger:** `--accent-danger` background, weight 600
- **Size:** Height `36px` (sm), `40px` (md), `48px` (lg); horizontal padding `16px/20px/24px`

### Cards / Containers
- **Background:** `--bg-panel`
- **Border:** 1px solid `--border-subtle`
- **Corner Roundness:** `4px` — barely perceptible, industrial
- **Shadow:** None by default. Elevated cards use a `0 4px 24px rgba(0,0,0,0.4)` diffused shadow

### Inputs / Forms
- **Background:** `--bg-abyss`
- **Border:** 1px solid `--border-subtle`, transitions to `--accent-primary` on focus
- **Text:** `--text-primary`
- **Placeholder:** `--text-disabled`
- **Height:** `40px`, padding `0 12px`

### Sidebar
- **Width:** `260px` collapsed-friendly
- **Background:** `--bg-sidebar`
- **Active Item:** Left 3px accent bar (`--accent-primary`), background `--bg-elevated`
- **Item Padding:** `8px 16px`

### Chat Bubbles
- **Own messages:** `--accent-primary` at 15% opacity background, left-aligned
- **Others' messages:** `--bg-elevated` background
- **Timestamps:** `--text-muted`, 11px

### Badges (Unread)
- **Background:** `--accent-danger`
- **Text:** White, weight 700, `0.625rem`
- **Shape:** Pill (`border-radius: 999px`), min-width `18px`, height `18px`

---

## 5. Layout Principles

- **Grid Base:** 8px spacing unit (all margins, paddings, gaps use multiples of 8)
- **Sidebar Width:** `260px`
- **Content Max Width:** Fluid within remaining viewport
- **Panel Gaps:** `16px` between panels, `24px` section spacing
- **Chat Area:** Full-height flex column, messages scroll, composer pinned bottom
- **Responsive:** Sidebar collapses to icon-rail at `< 768px`, overlays at `< 640px`

---

## 6. Interaction & Motion

- **Transitions:** `150ms ease` for color/opacity, `200ms ease` for transforms
- **Hover States:** Lighten background by one tier (e.g., `--bg-panel` → `--bg-elevated`)
- **Focus Rings:** 2px solid `--accent-primary` with `2px` offset
- **Loading States:** Skeleton shimmer using `--bg-elevated` → `--border-subtle` gradient pulse
- **Scroll:** Custom scrollbar — `6px` wide, `--border-subtle` track, `--text-disabled` thumb
