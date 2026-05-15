import type { Meta, StoryObj } from "@storybook/nextjs-vite"
import { Badge } from "./badge"

const meta = {
  component: Badge,
  tags: ["ai-generated"],
  argTypes: {
    variant: {
      control: "select",
      options: ["default", "secondary", "destructive", "outline", "ghost", "link"],
    },
  },
} satisfies Meta<typeof Badge>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: { children: "v1.2 available" },
}

export const Secondary: Story = {
  args: { children: "Beta", variant: "secondary" },
}

export const Destructive: Story = {
  args: { children: "Error", variant: "destructive" },
}

export const Outline: Story = {
  args: { children: "Experimental", variant: "outline" },
}

export const UpdateAvailable: Story = {
  args: { children: "⬆ v1.1.0 available", variant: "default" },
}
