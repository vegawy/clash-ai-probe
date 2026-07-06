---
name: Precision Core
colors:
  surface: '#131314'
  surface-dim: '#131314'
  surface-bright: '#3a3939'
  surface-container-lowest: '#0e0e0f'
  surface-container-low: '#1c1b1c'
  surface-container: '#201f20'
  surface-container-high: '#2a2a2a'
  surface-container-highest: '#353435'
  on-surface: '#e5e2e2'
  on-surface-variant: '#c6c6cb'
  inverse-surface: '#e5e2e2'
  inverse-on-surface: '#313031'
  outline: '#8f9095'
  outline-variant: '#45474b'
  surface-tint: '#c3c6cf'
  primary: '#c3c6cf'
  on-primary: '#2d3137'
  primary-container: '#0d1117'
  on-primary-container: '#797d85'
  inverse-primary: '#5b5e66'
  secondary: '#4edea3'
  on-secondary: '#003824'
  secondary-container: '#00a572'
  on-secondary-container: '#00311f'
  tertiary: '#c0c1ff'
  on-tertiary: '#1000a9'
  tertiary-container: '#03004c'
  on-tertiary-container: '#686cf7'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#dfe2eb'
  primary-fixed-dim: '#c3c6cf'
  on-primary-fixed: '#181c22'
  on-primary-fixed-variant: '#43474e'
  secondary-fixed: '#6ffbbe'
  secondary-fixed-dim: '#4edea3'
  on-secondary-fixed: '#002113'
  on-secondary-fixed-variant: '#005236'
  tertiary-fixed: '#e1e0ff'
  tertiary-fixed-dim: '#c0c1ff'
  on-tertiary-fixed: '#07006c'
  on-tertiary-fixed-variant: '#2f2ebe'
  background: '#131314'
  on-background: '#e5e2e2'
  surface-variant: '#353435'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.02em
  display-lg-mobile:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
  headline-md:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
  mono-data:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '500'
    lineHeight: 18px
  label-caps:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '700'
    lineHeight: 12px
    letterSpacing: 0.05em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  unit: 4px
  container-padding: 24px
  gutter: 16px
  sidebar-width: 240px
  density-compact: 4px
  density-comfortable: 12px
---

## Brand & Style

The design system is engineered for high-stakes infrastructure monitoring, where speed of comprehension is the primary metric. The brand personality is rooted in **Industrial Precision**: it is clinical, authoritative, and unapologetically technical. The target audience consists of DevOps engineers and SREs who require immediate clarity on proxy health and latency data.

The design style utilizes **Modern Corporate** principles with a heavy emphasis on **High-Contrast** data visualization. It avoids decorative elements, prioritizing a "dashboard-as-a-tool" philosophy. The UI should evoke a sense of absolute control and real-time responsiveness, using crisp lines and a structured grid to manage high information density without inducing cognitive overload.

## Colors

The color strategy for the design system is built on a "Dark Mode" foundation to reduce eye strain during long monitoring sessions. 

- **Primary Background**: Deep Obsidian (#0D1117) provides a high-contrast base for data.
- **Semantic Logic**: Color is used exclusively for functional signaling. 
    - **Vibrant Green**: Indicates 100% uptime and stable latency.
    - **Amber**: Signals jitter, rate-limiting, or fluctuating response times.
    - **Critical Red**: Immediate action required; proxy down or 5xx errors.
    - **Indigo**: Active health checks or pending deployment states.
    - **Slate**: Explicitly inactive or maintenance modes.
- **Accents**: Use subtle Indigo for interactive elements that are not status-dependent, such as primary action buttons or selection states.

## Typography

The typography system prioritizes legibility of alphanumeric strings. **Inter** is the primary typeface for its exceptional clarity in UI contexts. For technical logs, IP addresses, and latency metrics, **JetBrains Mono** is introduced to ensure character distinction (e.g., 0 vs O) and consistent vertical alignment in data tables.

- **Numeric Data**: Always use tabular lining for numbers to prevent horizontal shifting during real-time data refreshes.
- **Labels**: Small caps are used for table headers and section titles to create a clear visual hierarchy between metadata and primary values.
- **Scale**: The system uses a tight scale to maximize information density on the screen.

## Layout & Spacing

This design system employs a **Fluid Grid** with a "Desktop-First" approach, optimized for ultra-wide monitors used in NOC (Network Operations Center) environments.

- **Structure**: A fixed left-hand sidebar for navigation, with a flexible main content area that expands to 100% of the viewport width.
- **Rhythm**: A 4px baseline grid governs all spacing.
- **Density**: Use "Compact" spacing (4px - 8px) within data tables and "Comfortable" spacing (16px - 24px) for layout margins and widget containers.
- **Breakpoints**:
    - **Desktop (1440px+)**: 12-column layout, full sidebar.
    - **Tablet (768px - 1439px)**: 8-column layout, collapsed sidebar (icons only).
    - **Mobile (< 767px)**: Single column stacked; overflow tables with horizontal scroll.

## Elevation & Depth

Elevation in the design system is achieved through **Tonal Layers** rather than heavy shadows, maintaining the industrial look.

- **Level 0 (Background)**: #0D1117 - The base canvas.
- **Level 1 (Cards/Widgets)**: #161B22 - Surfaces for charts and tables.
- **Level 2 (Popovers/Modals)**: #21262D - Elements that float above the main grid.
- **Borders**: All containers use a 1px solid border (#30363D) to define boundaries. Shadows are reserved for critical overrides or modals, using a sharp, low-spread black shadow to maintain the "flat" industrial aesthetic.

## Shapes

The shape language is "Soft" yet disciplined. A standard **4px (0.25rem)** border radius is applied to buttons, input fields, and card containers. This provides just enough softness to ensure the UI feels modern, while the small radius maintains the structural, "gridded" appearance of a professional tool. Large components like modals may use an **8px (0.5rem)** radius, but never beyond that.

## Components

- **Data Tables**: The core of the system. Rows must have a hover state (#1C2128) and support "zebra striping" for deep logs. Column headers should include sorting indicators.
- **Micro-Sparklines**: Integrated directly into table rows to show the last 30 minutes of latency. Use a 1px stroke weight without fill.
- **Status Badges**: Small, pill-shaped indicators with a subtle background tint and high-contrast foreground text (e.g., Green text on dark green background).
- **Primary Buttons**: Solid Indigo (#6366F1) with white text. Use square corners or the 4px radius defined in Shapes.
- **Input Fields**: Inset appearance with a 1px border. Focus state must use a 1px Indigo ring.
- **Sophisticated Charts**: Line and area charts should use high-tension curves (almost straight lines) to emphasize the "raw data" feel. Use the status colors for series mapping.
- **Health Indicators**: A "Heartbeat" animation (subtle opacity pulse) for the "Stable" status in the header to indicate the data stream is live.