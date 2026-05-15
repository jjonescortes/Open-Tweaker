import type { Meta, StoryObj } from "@storybook/nextjs-vite"

const meta = {
  title: "Design System/Colors",
  tags: ["ai-generated"],
  parameters: { controls: { hideNoControlsWarning: true } },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

function Swatch({ label, variable, textVar }: { label: string; variable: string; textVar?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div
        className="h-14 w-full rounded-md border border-white/10"
        style={{ background: `var(${variable})` }}
      />
      <p className="text-xs font-medium text-foreground">{label}</p>
      <p className="font-mono text-[10px] text-muted-foreground">{variable}</p>
    </div>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-8">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">{children}</div>
    </div>
  )
}

export const AllTokens: Story = {
  name: "All Color Tokens",
  render: () => (
    <div className="space-y-2">
      <Group title="Base">
        <Swatch label="Background" variable="--background" />
        <Swatch label="Foreground" variable="--foreground" />
        <Swatch label="Border" variable="--border" />
        <Swatch label="Input" variable="--input" />
        <Swatch label="Ring" variable="--ring" />
      </Group>

      <Group title="Primary">
        <Swatch label="Primary" variable="--primary" />
        <Swatch label="Primary Foreground" variable="--primary-foreground" />
      </Group>

      <Group title="Secondary">
        <Swatch label="Secondary" variable="--secondary" />
        <Swatch label="Secondary Foreground" variable="--secondary-foreground" />
      </Group>

      <Group title="Muted">
        <Swatch label="Muted" variable="--muted" />
        <Swatch label="Muted Foreground" variable="--muted-foreground" />
      </Group>

      <Group title="Accent">
        <Swatch label="Accent" variable="--accent" />
        <Swatch label="Accent Foreground" variable="--accent-foreground" />
      </Group>

      <Group title="Card">
        <Swatch label="Card" variable="--card" />
        <Swatch label="Card Foreground" variable="--card-foreground" />
      </Group>

      <Group title="Popover">
        <Swatch label="Popover" variable="--popover" />
        <Swatch label="Popover Foreground" variable="--popover-foreground" />
      </Group>

      <Group title="Destructive">
        <Swatch label="Destructive" variable="--destructive" />
      </Group>

      <Group title="Sidebar">
        <Swatch label="Sidebar" variable="--sidebar" />
        <Swatch label="Sidebar Foreground" variable="--sidebar-foreground" />
        <Swatch label="Sidebar Primary" variable="--sidebar-primary" />
        <Swatch label="Sidebar Primary FG" variable="--sidebar-primary-foreground" />
        <Swatch label="Sidebar Accent" variable="--sidebar-accent" />
        <Swatch label="Sidebar Border" variable="--sidebar-border" />
      </Group>

      <Group title="Charts">
        <Swatch label="Chart 1" variable="--chart-1" />
        <Swatch label="Chart 2" variable="--chart-2" />
        <Swatch label="Chart 3" variable="--chart-3" />
        <Swatch label="Chart 4" variable="--chart-4" />
        <Swatch label="Chart 5" variable="--chart-5" />
      </Group>
    </div>
  ),
}
