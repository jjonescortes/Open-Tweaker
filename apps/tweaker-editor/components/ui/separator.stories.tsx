import type { Meta, StoryObj } from "@storybook/nextjs-vite"
import { Separator } from "./separator"

const meta = {
  component: Separator,
  tags: ["ai-generated"],
  argTypes: {
    orientation: { control: "radio", options: ["horizontal", "vertical"] },
  },
} satisfies Meta<typeof Separator>

export default meta
type Story = StoryObj<typeof meta>

export const Horizontal: Story = {
  render: () => (
    <div className="space-y-4 w-72">
      <p className="text-sm text-foreground">Section above</p>
      <Separator />
      <p className="text-sm text-foreground">Section below</p>
    </div>
  ),
}

export const Vertical: Story = {
  render: () => (
    <div className="flex h-8 items-center gap-3">
      <span className="text-sm text-foreground">Layers</span>
      <Separator orientation="vertical" />
      <span className="text-sm text-foreground">Components</span>
      <Separator orientation="vertical" />
      <span className="text-sm text-foreground">Assets</span>
    </div>
  ),
}

export const InToolbar: Story = {
  name: "In Toolbar Context",
  render: () => (
    <div className="flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3">
      <span className="text-xs font-medium text-foreground">OpenTweaker</span>
      <Separator orientation="vertical" className="h-4" />
      <span className="text-xs text-muted-foreground">v1.0.0</span>
      <Separator orientation="vertical" className="h-4" />
      <span className="text-xs text-muted-foreground">localhost:3000</span>
    </div>
  ),
}
