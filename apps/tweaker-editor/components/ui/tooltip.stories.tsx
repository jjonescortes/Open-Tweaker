import type { Meta, StoryObj } from "@storybook/nextjs-vite"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip"
import { Button } from "./button"

const meta = {
  title: "UI/Tooltip",
  tags: ["ai-generated"],
  decorators: [
    (Story) => (
      <TooltipProvider>
        <div className="flex items-center justify-center py-12">
          <Story />
        </div>
      </TooltipProvider>
    ),
  ],
  parameters: { controls: { hideNoControlsWarning: true } },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <Tooltip defaultOpen>
      <TooltipTrigger asChild>
        <Button variant="outline">Hover me</Button>
      </TooltipTrigger>
      <TooltipContent>Write changes to source files</TooltipContent>
    </Tooltip>
  ),
}

export const OnIconButton: Story = {
  name: "On Icon Button",
  render: () => (
    <div className="flex gap-3">
      <Tooltip defaultOpen>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon">
            <i className="fa-solid fa-pen-ruler text-xs" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Pick element</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon">
            <i className="fa-solid fa-rotate-left text-xs" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Reset preview</TooltipContent>
      </Tooltip>
    </div>
  ),
}

export const Disabled: Story = {
  name: "Disabled Trigger",
  render: () => (
    <Tooltip defaultOpen>
      <TooltipTrigger asChild>
        <Button disabled>Apply to Source</Button>
      </TooltipTrigger>
      <TooltipContent>Start local server to enable</TooltipContent>
    </Tooltip>
  ),
}
