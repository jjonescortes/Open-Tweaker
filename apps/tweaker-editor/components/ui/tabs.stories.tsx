import type { Meta, StoryObj } from "@storybook/nextjs-vite"
import { expect } from "storybook/test"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./tabs"

const meta = {
  component: Tabs,
  tags: ["ai-generated"],
} satisfies Meta<typeof Tabs>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: { defaultValue: "layers" },
  render: (args) => (
    <Tabs {...args}>
      <TabsList>
        <TabsTrigger value="layers">Layers</TabsTrigger>
        <TabsTrigger value="components">Components</TabsTrigger>
        <TabsTrigger value="assets">Assets</TabsTrigger>
      </TabsList>
      <TabsContent value="layers">
        <p className="text-muted-foreground text-sm pt-2">Element tree goes here</p>
      </TabsContent>
      <TabsContent value="components">
        <p className="text-muted-foreground text-sm pt-2">Component list goes here</p>
      </TabsContent>
      <TabsContent value="assets">
        <p className="text-muted-foreground text-sm pt-2">Asset library goes here</p>
      </TabsContent>
    </Tabs>
  ),
  play: async ({ canvas }) => {
    const layersTab = canvas.getByRole("tab", { name: /layers/i })
    await expect(layersTab).toBeVisible()
    await expect(layersTab).toHaveAttribute("data-state", "active")
  },
}

export const LineVariant: Story = {
  args: { defaultValue: "inspector" },
  render: (args) => (
    <Tabs {...args}>
      <TabsList variant="line">
        <TabsTrigger value="inspector">Inspector</TabsTrigger>
        <TabsTrigger value="styles">Styles</TabsTrigger>
      </TabsList>
      <TabsContent value="inspector">
        <p className="text-muted-foreground text-sm pt-2">Inspector content</p>
      </TabsContent>
      <TabsContent value="styles">
        <p className="text-muted-foreground text-sm pt-2">Styles content</p>
      </TabsContent>
    </Tabs>
  ),
}
