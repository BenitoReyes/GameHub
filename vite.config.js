import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  root: path.resolve(__dirname, 'FrontEnd'),
  build: {
    outDir: path.resolve(__dirname, 'FrontEnd'),
    rollupOptions: {
      input: path.resolve(__dirname, 'FrontEnd/chat-entry.js'),
      output: {
        format: 'iife',
        name: 'StreamChatBundle',
        entryFileNames: 'stream-chat.bundle.js'
      }
    }
  }
});

// This configuration sets up Vite to bundle the StreamChat library for browser usage by putting it into a file named stream-chat.bundle.js in the FrontEnd directory where index.html can reference it directly.
