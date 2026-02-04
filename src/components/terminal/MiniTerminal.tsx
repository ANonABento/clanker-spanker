import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

interface MiniTerminalProps {
  output: string[];
  className?: string;
}

// Check if terminal is scrolled to bottom
function isAtBottom(terminal: Terminal): boolean {
  const buffer = terminal.buffer.active;
  // viewportY = line at top of viewport, baseY = line at top when scrolled to bottom
  // When at bottom: viewportY >= baseY
  return buffer.viewportY >= buffer.baseY;
}

export function MiniTerminal({ output, className = "" }: MiniTerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const lastOutputLengthRef = useRef(0);
  const userScrolledRef = useRef(false);

  // Initialize terminal
  useEffect(() => {
    if (!terminalRef.current) return;

    const terminal = new Terminal({
      rows: 4,
      cols: 50,
      fontSize: 10,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      theme: {
        background: "#0a0a0a",
        foreground: "#909090",
        cursor: "#909090",
        cursorAccent: "#0a0a0a",
        selectionBackground: "#404040",
        black: "#0a0a0a",
        red: "#ef4444",
        green: "#22c55e",
        yellow: "#eab308",
        blue: "#3b82f6",
        magenta: "#a855f7",
        cyan: "#06b6d4",
        white: "#e5e5e5",
        brightBlack: "#606060",
        brightRed: "#f87171",
        brightGreen: "#4ade80",
        brightYellow: "#fde047",
        brightBlue: "#60a5fa",
        brightMagenta: "#c084fc",
        brightCyan: "#22d3ee",
        brightWhite: "#ffffff",
      },
      scrollback: 100,
      cursorBlink: false,
      cursorStyle: "bar",
      disableStdin: true,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(terminalRef.current);

    // Fit terminal to container
    try {
      fitAddon.fit();
    } catch {
      // Ignore fit errors on initial render
    }

    xtermRef.current = terminal;
    fitAddonRef.current = fitAddon;
    lastOutputLengthRef.current = 0;
    userScrolledRef.current = false;

    // Track when user scrolls away from bottom
    terminal.onScroll(() => {
      userScrolledRef.current = !isAtBottom(terminal);
    });

    // Write initial output
    output.forEach((line) => {
      terminal.writeln(line);
    });
    lastOutputLengthRef.current = output.length;

    return () => {
      terminal.dispose();
    };
  }, []);

  // Write new output lines (preserving user scroll position)
  useEffect(() => {
    const terminal = xtermRef.current;
    if (!terminal) return;

    // Check if user was at bottom before writing
    const wasAtBottom = isAtBottom(terminal);

    // Only write new lines
    const newLines = output.slice(lastOutputLengthRef.current);
    newLines.forEach((line) => {
      terminal.writeln(line);
    });
    lastOutputLengthRef.current = output.length;

    // Only auto-scroll if user was at bottom (respect their scroll position)
    if (wasAtBottom && newLines.length > 0) {
      terminal.scrollToBottom();
    }
  }, [output]);

  // Handle resize
  useEffect(() => {
    const handleResize = () => {
      try {
        fitAddonRef.current?.fit();
      } catch {
        // Ignore fit errors
      }
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return (
    <div
      ref={terminalRef}
      className={`overflow-hidden rounded border-l-2 border-l-[#8b5cf6]/30 border border-[#1a1a1a] h-full p-2 ${className}`}
    />
  );
}
