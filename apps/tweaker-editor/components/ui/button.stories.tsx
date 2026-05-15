import type { Meta, StoryObj } from "@storybook/nextjs-vite"
import { expect } from "storybook/test"
import { Button } from "./button"

const meta = {
  component: Button,
  tags: ["ai-generated"],
  argTypes: {
    variant: {
      control: "select",
      options: ["default", "outline", "secondary", "ghost", "destructive", "link"],
    },
    size: {
      control: "select",
      options: ["default", "xs", "sm", "lg", "icon", "icon-xs", "icon-sm", "icon-lg"],
    },
    disabled: { control: "boolean" },
  },
} satisfies Meta<typeof Button>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: { children: "Apply to Source" },
  play: async ({ canvas }) => {
    const btn = canvas.getByRole("button", { name: /apply to source/i })
    await expect(btn).toBeVisible()
    await expect(btn).not.toBeDisabled()
  },
}

// CssCheck — verifies that Tailwind + global CSS loaded by asserting primary button
// uses the theme background color (oklch maps to a non-transparent background).
export const CssCheck: Story = {
  args: { children: "Submit", variant: "default" },
  play: async ({ canvas }) => {
    const btn = canvas.getByRole("button", { name: /submit/i })
    const bg = getComputedStyle(btn).backgroundColor
    // The default variant uses bg-primary which is a non-transparent color.
    // If CSS didn't load this would be "rgba(0, 0, 0, 0)" (transparent).
    await expect(bg).not.toBe("rgba(0, 0, 0, 0)")
    await expect(bg).not.toBe("")
  },
}

export const Outline: Story = {
  args: { children: "Reset", variant: "outline" },
}

export const Secondary: Story = {
  args: { children: "Cancel", variant: "secondary" },
}

export const Ghost: Story = {
  args: { children: "Close", variant: "ghost" },
}

export const Destructive: Story = {
  args: { children: "Delete", variant: "destructive" },
}

export const Small: Story = {
  args: { children: "Pick element", size: "sm" },
}

export const Disabled: Story = {
  args: { children: "Server offline", disabled: true },
}
