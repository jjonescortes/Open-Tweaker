import type { Meta, StoryObj } from "@storybook/nextjs-vite"
import { expect } from "storybook/test"
import { Input } from "./input"

const meta = {
  component: Input,
  tags: ["ai-generated"],
  argTypes: {
    disabled: { control: "boolean" },
    type: {
      control: "select",
      options: ["text", "url", "search", "email", "password"],
    },
  },
} satisfies Meta<typeof Input>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: { placeholder: "http://localhost:3000", type: "url" },
  play: async ({ canvas }) => {
    const input = canvas.getByRole("textbox")
    await expect(input).toBeVisible()
    await expect(input).toHaveAttribute("type", "url")
  },
}

export const WithValue: Story = {
  args: { defaultValue: "http://localhost:8000", type: "url" },
}

export const Disabled: Story = {
  args: { value: "http://localhost:8000", disabled: true, readOnly: true },
}

export const Search: Story = {
  args: { placeholder: "Search components…", type: "search" },
}
