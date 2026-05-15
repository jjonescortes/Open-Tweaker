import type { Preview } from "@storybook/nextjs-vite"
import React from "react"
import "../app/globals.css"

const preview: Preview = {
  decorators: [
    (Story) => (
      <div className="dark antialiased font-sans bg-background text-foreground min-h-screen p-6">
        <Story />
      </div>
    ),
  ],
  parameters: {
    backgrounds: { disable: true },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    a11y: {
      test: "todo",
    },
  },
}

export default preview
