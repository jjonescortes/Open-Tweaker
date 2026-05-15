import type { Meta, StoryObj } from "@storybook/nextjs-vite"

const meta = {
  title: "Design System/Typography",
  tags: ["ai-generated"],
  parameters: { controls: { hideNoControlsWarning: true } },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const WEIGHTS = [
  { label: "Light", value: "300" },
  { label: "Regular", value: "400" },
  { label: "Medium", value: "500" },
  { label: "Semi Bold", value: "600" },
  { label: "Bold", value: "700" },
  { label: "Extra Bold", value: "800" },
]

const SIZES = [
  { label: "xs — 12px", class: "text-xs" },
  { label: "sm — 14px", class: "text-sm" },
  { label: "base — 16px", class: "text-base" },
  { label: "lg — 18px", class: "text-lg" },
  { label: "xl — 20px", class: "text-xl" },
  { label: "2xl — 24px", class: "text-2xl" },
  { label: "3xl — 30px", class: "text-3xl" },
  { label: "4xl — 36px", class: "text-4xl" },
]

export const SansFont: Story = {
  name: "Figtree (font-sans)",
  render: () => (
    <div className="space-y-8">
      <div>
        <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Specimen — Weights
        </p>
        <div className="space-y-3">
          {WEIGHTS.map(({ label, value }) => (
            <div key={value} className="flex items-baseline gap-4">
              <span className="w-24 shrink-0 text-xs text-muted-foreground">{label} {value}</span>
              <span className="font-sans text-2xl" style={{ fontWeight: value }}>
                OpenTweaker — Live visual editor
              </span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Size Scale
        </p>
        <div className="space-y-2">
          {SIZES.map(({ label, class: cls }) => (
            <div key={cls} className="flex items-baseline gap-4">
              <span className="w-28 shrink-0 text-xs text-muted-foreground">{label}</span>
              <span className={`font-sans ${cls}`}>The quick brown fox</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Paragraph
        </p>
        <p className="max-w-prose font-sans text-base leading-relaxed text-foreground">
          OpenTweaker is a live visual editor for your web app. Pick any element, tweak colors,
          fonts, and spacing in real time, then write the changes back to your source files — all
          without leaving the browser.
        </p>
      </div>

      <div>
        <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          All Characters
        </p>
        <p className="font-sans text-lg tracking-wide">
          ABCDEFGHIJKLMNOPQRSTUVWXYZ
        </p>
        <p className="font-sans text-lg tracking-wide">
          abcdefghijklmnopqrstuvwxyz
        </p>
        <p className="font-sans text-lg tracking-wide">
          0123456789 !@#$%^&*()_+-=[]&#123;&#125;;':",&lt;&gt;?
        </p>
      </div>
    </div>
  ),
}

export const MonoFont: Story = {
  name: "Geist Mono (font-mono)",
  render: () => (
    <div className="space-y-8">
      <div>
        <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Specimen
        </p>
        <div className="space-y-3">
          {WEIGHTS.slice(1, 5).map(({ label, value }) => (
            <div key={value} className="flex items-baseline gap-4">
              <span className="w-24 shrink-0 text-xs text-muted-foreground">{label}</span>
              <span className="font-mono text-xl" style={{ fontWeight: value }}>
                background-color: #1a1a2e;
              </span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Code Sample
        </p>
        <pre className="rounded-lg bg-muted p-4 font-mono text-sm text-foreground">
{`.btn-primary {
  background-color: var(--primary);
  color: var(--primary-foreground);
  border-radius: var(--radius);
  padding: 0.5rem 1rem;
  font-weight: 600;
}`}
        </pre>
      </div>

      <div>
        <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Size Scale
        </p>
        <div className="space-y-2">
          {SIZES.slice(0, 5).map(({ label, class: cls }) => (
            <div key={cls} className="flex items-baseline gap-4">
              <span className="w-28 shrink-0 text-xs text-muted-foreground">{label}</span>
              <span className={`font-mono ${cls}`}>font-size: 1rem;</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  ),
}
