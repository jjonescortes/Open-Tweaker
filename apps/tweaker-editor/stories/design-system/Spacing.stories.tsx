import type { Meta, StoryObj } from "@storybook/nextjs-vite"

const meta = {
  title: "Design System/Spacing & Radius",
  tags: ["ai-generated"],
  parameters: { controls: { hideNoControlsWarning: true } },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const SPACING = [
  { label: "0", class: "w-0", px: "0px" },
  { label: "0.5", class: "w-0.5", px: "2px" },
  { label: "1", class: "w-1", px: "4px" },
  { label: "1.5", class: "w-1.5", px: "6px" },
  { label: "2", class: "w-2", px: "8px" },
  { label: "2.5", class: "w-2.5", px: "10px" },
  { label: "3", class: "w-3", px: "12px" },
  { label: "4", class: "w-4", px: "16px" },
  { label: "5", class: "w-5", px: "20px" },
  { label: "6", class: "w-6", px: "24px" },
  { label: "8", class: "w-8", px: "32px" },
  { label: "10", class: "w-10", px: "40px" },
  { label: "12", class: "w-12", px: "48px" },
  { label: "16", class: "w-16", px: "64px" },
  { label: "20", class: "w-20", px: "80px" },
  { label: "24", class: "w-24", px: "96px" },
  { label: "32", class: "w-32", px: "128px" },
  { label: "40", class: "w-40", px: "160px" },
  { label: "48", class: "w-48", px: "192px" },
  { label: "64", class: "w-64", px: "256px" },
]

const RADII = [
  { label: "sm", variable: "--radius-sm", class: "rounded-sm" },
  { label: "md", variable: "--radius-md", class: "rounded-md" },
  { label: "lg", variable: "--radius-lg", class: "rounded-lg" },
  { label: "xl", variable: "--radius-xl", class: "rounded-xl" },
  { label: "2xl", variable: "--radius-2xl", class: "rounded-2xl" },
  { label: "3xl", variable: "--radius-3xl", class: "rounded-3xl" },
  { label: "full", variable: "9999px", class: "rounded-full" },
]

export const SpacingScale: Story = {
  render: () => (
    <div>
      <h2 className="mb-6 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        Spacing Scale (Tailwind base = 4px)
      </h2>
      <div className="space-y-2">
        {SPACING.map(({ label, class: cls, px }) => (
          <div key={label} className="flex items-center gap-4">
            <span className="w-10 shrink-0 text-right font-mono text-xs text-muted-foreground">{label}</span>
            <span className="w-16 shrink-0 text-xs text-muted-foreground">{px}</span>
            <div className={`h-4 bg-primary ${cls} min-w-px rounded-sm`} />
          </div>
        ))}
      </div>
    </div>
  ),
}

export const BorderRadiusScale: Story = {
  render: () => (
    <div>
      <h2 className="mb-6 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        Border Radius Tokens
      </h2>
      <div className="flex flex-wrap gap-6">
        {RADII.map(({ label, variable, class: cls }) => (
          <div key={label} className="flex flex-col items-center gap-2">
            <div
              className={`h-16 w-16 bg-primary/30 border border-primary ${cls}`}
            />
            <span className="text-xs font-medium text-foreground">{label}</span>
            <span className="font-mono text-[10px] text-muted-foreground">
              {variable.startsWith("--") ? `var(${variable})` : variable}
            </span>
          </div>
        ))}
      </div>
    </div>
  ),
}

export const ShadowScale: Story = {
  render: () => (
    <div>
      <h2 className="mb-6 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        Shadows
      </h2>
      <div className="flex flex-wrap gap-8">
        {[
          { label: "sm", class: "shadow-sm" },
          { label: "md", class: "shadow-md" },
          { label: "lg", class: "shadow-lg" },
          { label: "xl", class: "shadow-xl" },
          { label: "2xl", class: "shadow-2xl" },
        ].map(({ label, class: cls }) => (
          <div key={label} className="flex flex-col items-center gap-3">
            <div className={`h-16 w-16 rounded-lg bg-card ${cls}`} />
            <span className="text-xs text-muted-foreground">{label}</span>
          </div>
        ))}
      </div>
    </div>
  ),
}
