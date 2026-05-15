"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ElementInfo {
  selector: string;
  tag: string;
  id: string | null;
  classes: string[];
  rect: { left: number; top: number; width: number; height: number };
  styles: Record<string, string>;
}

interface SessionChange {
  id: string;
  selector: string;
  property: string;
  value: string;
  source: string;
}

interface Component {
  name: string;
  file: string;
  styleFiles: string[];
  rules: Array<{ selector: string; declarations: string; file: string }>;
}

interface DesignCtx {
  libraries: string[];
  shadcn: Record<string, unknown> | null;
  tailwind: { file: string; colors: Record<string, string>; raw: string } | null;
  tokens: Record<string, unknown>;
  components: Array<{
    file: string;
    name: string;
    type: string;
    system?: string;
    variants?: Array<{ name: string; options: string[] }>;
    slots?: string[];
    propsInterface?: string;
    stories?: string[];
  }>;
  docs: Array<{ file: string; excerpt: string }>;
}

interface Token {
  name: string;
  value: string;
  type: "css" | "scss";
  file: string;
}

const SERVER = "http://localhost:4242";

// ── Tailwind utility regex (for bestSelector) ──────────────────────────────────
const TAILWIND_UTIL =
  /^(flex|grid|block|inline|hidden|absolute|relative|fixed|sticky|static|overflow|truncate|sr-only|not-sr|w-|h-|min-|max-|p-|px-|py-|pt-|pr-|pb-|pl-|m-|mx-|my-|mt-|mr-|mb-|ml-|gap-|space-|col-|row-|order-|basis-|grow|shrink|text-|font-|leading-|tracking-|align-|justify-|items-|self-|content-|bg-|border|rounded|shadow|opacity-|z-|cursor-|select-|resize|appearance|outline|ring-|transition|duration|ease|delay|animate|transform|scale|rotate|translate|skew|origin|fill-|stroke-|from-|via-|to-|decoration|underline|line-through|no-underline|capitalize|uppercase|lowercase|normal-|italic|not-italic|antialiased|subpixel|tabular|proportional|ordinal|slashed|lining|oldstyle|pointer|focus|hover|active|disabled|group|peer|data-\[|aria-|dark:|sm:|md:|lg:|xl:)/;

// ── bestSelector ───────────────────────────────────────────────────────────────
function bestSelector(el: Element, frameDoc: Document): string {
  if (!el) return "";
  const attr = (n: string) => el.getAttribute?.(n);

  if (el.id && !/^[:r]|^(radix-|vte|vtb)/.test(el.id)) return "#" + el.id;

  const slot = attr("data-slot");
  if (slot) return `[data-slot="${slot}"]`;

  const part = attr("data-part");
  if (part) return `[data-part="${part}"]`;

  const huiId = attr("data-headlessui-id");
  if (huiId) return `[data-headlessui-id="${huiId}"]`;

  const HASHED = /^(css-[a-z0-9]{4,}|[a-z]-[a-z0-9]{6,}|sc-[a-zA-Z0-9]+)$/;
  const meaningful = [...(el.classList || [])].filter(
    (c) =>
      !TAILWIND_UTIL.test(c) &&
      !HASHED.test(c) &&
      !/^(vte|vtb|vt-)/.test(c) &&
      c.length > 2
  );
  if (meaningful.length)
    return el.tagName.toLowerCase() + "." + meaningful.slice(0, 2).join(".");

  const role = attr("role");
  if (role && role !== "none" && role !== "presentation") {
    return `${el.tagName.toLowerCase()}[role="${role}"]`;
  }

  const state = attr("data-state");
  if (state) return `${el.tagName.toLowerCase()}[data-state="${state}"]`;

  for (const a of [
    "data-selected",
    "data-active",
    "data-checked",
    "data-orientation",
  ]) {
    const v = attr(a);
    if (v !== null && v !== undefined)
      return `${el.tagName.toLowerCase()}[${a}]`;
  }

  const parent = el.parentElement;
  if (parent && parent !== frameDoc?.body && parent !== frameDoc?.documentElement) {
    const ps = bestSelector(parent, frameDoc);
    if (ps && ps !== parent.tagName?.toLowerCase()) {
      return `${ps} > ${el.tagName.toLowerCase()}`;
    }
  }

  return el.tagName.toLowerCase();
}

// ── toHex ──────────────────────────────────────────────────────────────────────
function toHex(color: string | undefined): string | null {
  if (!color || typeof color !== "string") return null;
  const s = color.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s;
  if (/^#[0-9a-fA-F]{3}$/.test(s))
    return "#" + [...s.slice(1)].map((c) => c + c).join("");
  const rgb = s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgb)
    return (
      "#" +
      [rgb[1], rgb[2], rgb[3]]
        .map((n) => parseInt(n).toString(16).padStart(2, "0"))
        .join("")
    );
  if (typeof document !== "undefined") {
    const tmp = document.createElement("canvas");
    tmp.width = tmp.height = 1;
    const ctx2 = tmp.getContext("2d");
    if (ctx2) {
      ctx2.fillStyle = s;
      ctx2.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx2.getImageData(0, 0, 1, 1).data;
      if (a === 0) return null;
      return "#" + [r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("");
    }
  }
  return null;
}

// ── buildPrompt ────────────────────────────────────────────────────────────────
function buildPrompt(changes: SessionChange[], ctx: DesignCtx | null): string {
  const L: string[] = [];
  L.push("# Visual Design Changes — Claude Code Implementation Brief");
  L.push("");
  L.push("Captured via WYSIWYG visual editor on the live dev server. Each change was");
  L.push("visually verified — selector matched a real DOM element. Please implement");
  L.push("in the cleanest way for this codebase.");
  L.push("");
  L.push("## Design System Context");
  if (ctx?.libraries?.length) {
    L.push("");
    L.push("**Libraries:** " + ctx.libraries.join(", "));
  }
  if (ctx?.tailwind?.colors && Object.keys(ctx.tailwind.colors).length) {
    L.push("");
    L.push(`**Tailwind config** (${ctx.tailwind.file}):`);
    Object.entries(ctx.tailwind.colors)
      .slice(0, 10)
      .forEach(([k, v]) => L.push(`  ${k}: ${v}`));
  }
  const cvaComps = (ctx?.components || []).filter((c) => c.type === "cva");
  if (cvaComps.length) {
    L.push("");
    L.push("**Component variant system (cva):**");
    cvaComps.slice(0, 6).forEach((c) => {
      L.push(
        `  ${c.name}: ${c.variants?.map((v) => `${v.name}(${v.options?.join("|")})`).join(", ")}`
      );
    });
  }
  L.push("");
  L.push("## Recorded Changes");
  L.push("");
  const bySel = new Map<string, SessionChange[]>();
  changes.forEach((ch) => {
    if (!bySel.has(ch.selector)) bySel.set(ch.selector, []);
    bySel.get(ch.selector)!.push(ch);
  });
  let i = 1;
  bySel.forEach((chs, sel) => {
    L.push(`### ${i++}. \`${sel}\``);
    L.push("```css");
    chs.forEach((ch) => L.push(`${ch.property}: ${ch.value};`));
    L.push("```");
    L.push("");
  });
  L.push("## Implementation Notes");
  L.push("- Prefer CVA variant updates over raw CSS for shadcn/Radix components");
  L.push("- Use Tailwind utilities if they map cleanly to the value");
  L.push("- Reference existing design tokens rather than hardcoding values");
  L.push("- Only modify the selectors listed. Preserve all other variants.");
  return L.join("\n");
}

// ══════════════════════════════════════════════════════════════════════════════
// TWEAKPANE INSPECTOR COMPONENT
// ══════════════════════════════════════════════════════════════════════════════

const TWEAKPANE_THEME = `
  .tp-dfwv {
    --tp-base-background-color: oklch(0.12 0 0);
    --tp-base-shadow-color: transparent;
    --tp-button-background-color: oklch(0.18 0 0);
    --tp-button-background-color-active: oklch(0.24 0 0);
    --tp-button-background-color-focus: oklch(0.22 0 0);
    --tp-button-background-color-hover: oklch(0.20 0 0);
    --tp-button-foreground-color: oklch(0.9 0 0);
    --tp-container-background-color: oklch(0.15 0 0);
    --tp-container-background-color-active: oklch(0.18 0 0);
    --tp-container-background-color-focus: oklch(0.17 0 0);
    --tp-container-background-color-hover: oklch(0.16 0 0);
    --tp-container-foreground-color: oklch(0.9 0 0);
    --tp-groove-foreground-color: oklch(0.22 0 0);
    --tp-input-background-color: oklch(0.16 0 0);
    --tp-input-background-color-active: oklch(0.22 0 0);
    --tp-input-background-color-focus: oklch(0.20 0 0);
    --tp-input-background-color-hover: oklch(0.18 0 0);
    --tp-input-foreground-color: oklch(0.95 0 0);
    --tp-label-foreground-color: oklch(0.55 0 0);
    --tp-monitor-background-color: oklch(0.12 0 0);
    --tp-monitor-foreground-color: oklch(0.7 0 0);
    border: none !important;
    width: 100% !important;
  }
  .tp-dfwv .tp-lblv_l { font-size: 10px !important; }
  .tp-dfwv .tp-fldv_t { font-size: 10px !important; text-transform: uppercase; letter-spacing: .06em; }
  .tp-dfwv .tp-sglv_i::-webkit-slider-thumb,
  .tp-dfwv input[type=range]::-webkit-slider-thumb {
    background: oklch(0.852 0.199 91.936) !important;
  }
`;

function TweakpaneInspector({
  elInfo,
  onChange,
}: {
  elInfo: { selector: string; styles: Record<string, string> };
  onChange: (prop: string, val: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.innerHTML = "";

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let pane: any = null;

    async function build() {
      const { Pane } = await import("tweakpane");
      const EssentialsPlugin = await import("@tweakpane/plugin-essentials");

      if (!containerRef.current) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pane = new Pane({ container: containerRef.current }) as any;
      pane.registerPlugin(EssentialsPlugin);

      const s = elInfo.styles;
      const px = (v: string) => parseFloat(v) || 0;

      // ── Color ──────────────────────────────────────────────────────────────
      const colF = pane.addFolder({ title: "Color", expanded: true });

      const colState = {
        background: s.backgroundColor || "#000000",
        text: s.color || "#000000",
        border: s.borderColor || "#000000",
      };
      colF.addBinding(colState, "background", { label: "Background", view: "color" })
        .on("change", ({ value }: any) => onChange("background-color", String(value)));
      colF.addBinding(colState, "text", { label: "Text", view: "color" })
        .on("change", ({ value }: any) => onChange("color", String(value)));
      colF.addBinding(colState, "border", { label: "Border", view: "color" })
        .on("change", ({ value }: any) => onChange("border-color", String(value)));

      // ── Typography ────────────────────────────────────────────────────────
      const typF = pane.addFolder({ title: "Typography", expanded: true });

      const typState = {
        fontSize: px(s.fontSize) || 14,
        fontWeight: parseFloat(s.fontWeight) || 400,
        lineHeight: parseFloat(s.lineHeight) || 1.5,
        letterSpacing: parseFloat(s.letterSpacing) || 0,
        textAlign: (["left","center","right","justify"].includes(s.textAlign) ? s.textAlign : "left"),
        textTransform: (["none","uppercase","lowercase","capitalize"].includes(s.textTransform) ? s.textTransform : "none"),
        textDecoration: s.textDecorationLine || "none",
      };
      typF.addBinding(typState, "fontSize", { label: "Size (px)", min: 6, max: 96, step: 1 })
        .on("change", ({ value }: any) => onChange("font-size", `${value}px`));
      typF.addBinding(typState, "fontWeight", { label: "Weight", min: 100, max: 900, step: 100 })
        .on("change", ({ value }: any) => onChange("font-weight", String(value)));
      typF.addBinding(typState, "lineHeight", { label: "Line Height", min: 0.8, max: 4, step: 0.05 })
        .on("change", ({ value }: any) => onChange("line-height", String(value)));
      typF.addBinding(typState, "letterSpacing", { label: "Letter Sp (px)", min: -5, max: 20, step: 0.5 })
        .on("change", ({ value }: any) => onChange("letter-spacing", `${value}px`));
      typF.addBinding(typState, "textAlign", {
        label: "Align",
        options: { Left: "left", Center: "center", Right: "right", Justify: "justify" },
      }).on("change", ({ value }: any) => onChange("text-align", String(value)));
      typF.addBinding(typState, "textTransform", {
        label: "Transform",
        options: { None: "none", Uppercase: "uppercase", Lowercase: "lowercase", Capitalize: "capitalize" },
      }).on("change", ({ value }: any) => onChange("text-transform", String(value)));

      // ── Spacing ───────────────────────────────────────────────────────────
      const spcF = pane.addFolder({ title: "Spacing", expanded: true });

      const spcState = {
        paddingTop: px(s.paddingTop), paddingRight: px(s.paddingRight),
        paddingBottom: px(s.paddingBottom), paddingLeft: px(s.paddingLeft),
        marginTop: px(s.marginTop), marginRight: px(s.marginRight),
        marginBottom: px(s.marginBottom), marginLeft: px(s.marginLeft),
        gap: px(s.gap),
      };
      ([ ["paddingTop","padding-top",0,120], ["paddingRight","padding-right",0,120],
         ["paddingBottom","padding-bottom",0,120], ["paddingLeft","padding-left",0,120],
      ] as [keyof typeof spcState, string, number, number][]).forEach(([k, prop, min, max]) => {
        spcF.addBinding(spcState, k, { label: prop, min, max, step: 1 })
          .on("change", ({ value }: any) => onChange(prop, `${value}px`));
      });
      ([ ["marginTop","margin-top",-60,120], ["marginRight","margin-right",-60,120],
         ["marginBottom","margin-bottom",-60,120], ["marginLeft","margin-left",-60,120],
      ] as [keyof typeof spcState, string, number, number][]).forEach(([k, prop, min, max]) => {
        spcF.addBinding(spcState, k, { label: prop, min, max, step: 1 })
          .on("change", ({ value }: any) => onChange(prop, `${value}px`));
      });
      spcF.addBinding(spcState, "gap", { label: "gap", min: 0, max: 80, step: 1 })
        .on("change", ({ value }: any) => onChange("gap", `${value}px`));

      // ── Layout ────────────────────────────────────────────────────────────
      const layF = pane.addFolder({ title: "Layout", expanded: true });

      const layState = {
        width: s.width || "auto",
        height: s.height || "auto",
        display: (["block","flex","inline-flex","grid","inline","inline-block","none"].includes(s.display) ? s.display : "block"),
        borderRadius: px(s.borderRadius),
        opacity: s.opacity !== "" && s.opacity != null ? parseFloat(s.opacity) : 1,
        overflow: (["visible","hidden","scroll","auto","clip"].includes(s.overflow) ? s.overflow : "visible"),
        position: (["static","relative","absolute","fixed","sticky"].includes(s.position) ? s.position : "static"),
      };
      layF.addBinding(layState, "width", { label: "width" })
        .on("change", ({ value }: any) => onChange("width", String(value)));
      layF.addBinding(layState, "height", { label: "height" })
        .on("change", ({ value }: any) => onChange("height", String(value)));
      layF.addBinding(layState, "display", {
        label: "display",
        options: { block:"block", flex:"flex", "inline-flex":"inline-flex", grid:"grid", inline:"inline", "inline-block":"inline-block", none:"none" },
      }).on("change", ({ value }: any) => onChange("display", String(value)));
      layF.addBinding(layState, "position", {
        label: "position",
        options: { static:"static", relative:"relative", absolute:"absolute", fixed:"fixed", sticky:"sticky" },
      }).on("change", ({ value }: any) => onChange("position", String(value)));
      layF.addBinding(layState, "overflow", {
        label: "overflow",
        options: { visible:"visible", hidden:"hidden", scroll:"scroll", auto:"auto", clip:"clip" },
      }).on("change", ({ value }: any) => onChange("overflow", String(value)));
      layF.addBinding(layState, "borderRadius", { label: "border-radius", min: 0, max: 60, step: 1 })
        .on("change", ({ value }: any) => onChange("border-radius", `${value}px`));
      layF.addBinding(layState, "opacity", { label: "opacity", min: 0, max: 1, step: 0.01 })
        .on("change", ({ value }: any) => onChange("opacity", String(value)));

      // ── Flex / Grid (contextual) ───────────────────────────────────────────
      if (["flex","inline-flex","grid","inline-grid"].includes(layState.display)) {
        const flexF = pane.addFolder({ title: layState.display.includes("grid") ? "Grid" : "Flex", expanded: true });
        const flexState = {
          flexDirection: (["row","row-reverse","column","column-reverse"].includes(s.flexDirection) ? s.flexDirection : "row"),
          justifyContent: s.justifyContent || "flex-start",
          alignItems: s.alignItems || "stretch",
          flexWrap: (["nowrap","wrap","wrap-reverse"].includes(s.flexWrap) ? s.flexWrap : "nowrap"),
        };
        flexF.addBinding(flexState, "flexDirection", {
          label: "direction",
          options: { row:"row", "row-reverse":"row-reverse", column:"column", "column-reverse":"column-reverse" },
        }).on("change", ({ value }: any) => onChange("flex-direction", String(value)));
        flexF.addBinding(flexState, "justifyContent", {
          label: "justify",
          options: { "flex-start":"flex-start", center:"center", "flex-end":"flex-end", "space-between":"space-between", "space-around":"space-around", "space-evenly":"space-evenly" },
        }).on("change", ({ value }: any) => onChange("justify-content", String(value)));
        flexF.addBinding(flexState, "alignItems", {
          label: "align",
          options: { stretch:"stretch", "flex-start":"flex-start", center:"center", "flex-end":"flex-end", baseline:"baseline" },
        }).on("change", ({ value }: any) => onChange("align-items", String(value)));
        flexF.addBinding(flexState, "flexWrap", {
          label: "wrap",
          options: { nowrap:"nowrap", wrap:"wrap", "wrap-reverse":"wrap-reverse" },
        }).on("change", ({ value }: any) => onChange("flex-wrap", String(value)));
      }

      // ── Border ───────────────────────────────────────────────────────────
      const brdF = pane.addFolder({ title: "Border", expanded: false });
      const brdState = {
        borderWidth: px(s.borderWidth),
        borderStyle: (["none","solid","dashed","dotted","double","groove"].includes(s.borderStyle) ? s.borderStyle : "none"),
        borderRadius: px(s.borderRadius),
      };
      brdF.addBinding(brdState, "borderWidth", { label: "width (px)", min: 0, max: 20, step: 1 })
        .on("change", ({ value }: any) => onChange("border-width", `${value}px`));
      brdF.addBinding(brdState, "borderStyle", {
        label: "style",
        options: { none:"none", solid:"solid", dashed:"dashed", dotted:"dotted", double:"double", groove:"groove" },
      }).on("change", ({ value }: any) => onChange("border-style", String(value)));
      brdF.addBinding(brdState, "borderRadius", { label: "radius (px)", min: 0, max: 60, step: 1 })
        .on("change", ({ value }: any) => onChange("border-radius", `${value}px`));

      // ── Effects ───────────────────────────────────────────────────────────
      const fxF = pane.addFolder({ title: "Effects", expanded: false });
      const fxState = {
        boxShadow: s.boxShadow === "none" ? "" : (s.boxShadow || ""),
        textShadow: s.textShadow === "none" ? "" : (s.textShadow || ""),
        filter: s.filter === "none" ? "" : (s.filter || ""),
        backdropFilter: s.backdropFilter === "none" ? "" : (s.backdropFilter || ""),
        transform: s.transform === "none" ? "" : (s.transform || ""),
        transition: s.transition === "all 0s ease 0s" ? "" : (s.transition || ""),
        cursor: s.cursor || "auto",
      };
      fxF.addBinding(fxState, "boxShadow", { label: "box-shadow" })
        .on("change", ({ value }: any) => onChange("box-shadow", String(value) || "none"));
      fxF.addBinding(fxState, "textShadow", { label: "text-shadow" })
        .on("change", ({ value }: any) => onChange("text-shadow", String(value) || "none"));
      fxF.addBinding(fxState, "filter", { label: "filter" })
        .on("change", ({ value }: any) => onChange("filter", String(value) || "none"));
      fxF.addBinding(fxState, "backdropFilter", { label: "backdrop-filter" })
        .on("change", ({ value }: any) => onChange("backdrop-filter", String(value) || "none"));
      fxF.addBinding(fxState, "transform", { label: "transform" })
        .on("change", ({ value }: any) => onChange("transform", String(value) || "none"));
      fxF.addBinding(fxState, "transition", { label: "transition" })
        .on("change", ({ value }: any) => onChange("transition", String(value)));
      fxF.addBinding(fxState, "cursor", {
        label: "cursor",
        options: { auto:"auto", pointer:"pointer", default:"default", move:"move", grab:"grab", "not-allowed":"not-allowed", text:"text", crosshair:"crosshair" },
      }).on("change", ({ value }: any) => onChange("cursor", String(value)));
    }

    build().catch(console.error);

    return () => { pane?.dispose(); };
  }, [elInfo, onChange]);

  return <div ref={containerRef} className="tp-wrap w-full" />;
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN EDITOR COMPONENT
// ══════════════════════════════════════════════════════════════════════════════

export default function EditorPage() {
  const frameRef = useRef<HTMLIFrameElement>(null);

  const [connected, setConnected] = useState(false);
  const [picking, setPicking] = useState(false);
  const [selectedEl, setSelectedEl] = useState<ElementInfo | null>(null);
  const [pendingProps, setPendingProps] = useState<Record<string, string>>({});
  const [zoom, setZoomState] = useState(1);
  const [components, setComponents] = useState<Component[] | null>(null);
  const [designCtx, setDesignCtx] = useState<DesignCtx | null>(null);
  const [sessionChanges, setSessionChanges] = useState<SessionChange[]>([]);
  const [sessionActive, setSessionActive] = useState(false);
  const [bottomOpen, setBottomOpen] = useState(true);
  const [urlValue, setUrlValue] = useState("http://localhost:5173");
  const [toast, setToast] = useState("");
  const [updateInfo, setUpdateInfo] = useState<{ current: string; latest: string | null; behind: boolean } | null>(null);
  const [updating, setUpdating] = useState(false);
  const [tokens, setTokens] = useState<Record<string, Token[]> | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // pick mode refs (to avoid stale closures in DOM listeners)
  const pickingRef = useRef(false);
  const selectedElRef = useRef<ElementInfo | null>(null);
  const pendingPropsRef = useRef<Record<string, string>>({});

  // sync refs with state
  // ── Version check on mount ────────────────────────────────────────────────
  useEffect(() => {
    fetch(`${SERVER}/version`)
      .then(r => r.json())
      .then(data => setUpdateInfo(data))
      .catch(() => {});
  }, []);

  useEffect(() => { pickingRef.current = picking; }, [picking]);
  useEffect(() => { selectedElRef.current = selectedEl; }, [selectedEl]);
  useEffect(() => { pendingPropsRef.current = pendingProps; }, [pendingProps]);

  // pick overlay refs
  const pickStyleRef = useRef<HTMLStyleElement | null>(null);
  const pickRingRef = useRef<HTMLDivElement | null>(null);
  const pickLabelRef = useRef<HTMLDivElement | null>(null);

  // ── Toast ──────────────────────────────────────────────────────────────────
  const showToast = useCallback((msg: string, dur = 2200) => {
    setToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(""), dur);
  }, []);


  // ── Frame helpers ──────────────────────────────────────────────────────────
  const frameDoc = useCallback(() => {
    try { return frameRef.current?.contentDocument ?? null; } catch { return null; }
  }, []);

  const frameWin = useCallback(() => {
    try { return frameRef.current?.contentWindow ?? null; } catch { return null; }
  }, []);

  // ── applyPreview — inject style tag into iframe ─────────────────────────────
  const applyPreview = useCallback((props?: Record<string, string>, selOverride?: string) => {
    const doc = frameDoc();
    if (!doc) return;
    let s = doc.getElementById("vte-preview") as HTMLStyleElement | null;
    if (!s) {
      s = doc.createElement("style");
      s.id = "vte-preview";
      doc.head.appendChild(s);
    }
    const el = selOverride ?? selectedElRef.current?.selector ?? "";
    const currentProps = props ?? pendingPropsRef.current;
    const decls = Object.entries(currentProps)
      .map(([k, v]) => `  ${k}: ${v} !important;`)
      .join("\n");
    s.textContent = el && decls ? `${el} {\n${decls}\n}` : "";
  }, [frameDoc]);

  // ── ensurePickUI ─────────────────────────────────────────────────────────────
  const ensurePickUI = useCallback(() => {
    const doc = frameDoc();
    if (!doc) return;
    if (!pickStyleRef.current) {
      const s = doc.createElement("style");
      s.id = "vte-pick-style";
      s.textContent = "* { cursor: crosshair !important; }";
      doc.head.appendChild(s);
      pickStyleRef.current = s;
    }
    if (!pickRingRef.current) {
      const ring = doc.createElement("div");
      ring.id = "vte-ring";
      ring.style.cssText = [
        "position:fixed", "z-index:2147483646", "pointer-events:none",
        "border:2px solid oklch(0.8868 0.1815 95.265)",
        "box-shadow:0 0 0 4px oklch(0.8868 0.1815 95.265/.15)",
        "border-radius:4px", "display:none", "transition:all .06s ease",
      ].join(";");
      doc.body.appendChild(ring);
      pickRingRef.current = ring;
    }
    if (!pickLabelRef.current) {
      const lbl = doc.createElement("div");
      lbl.id = "vte-label";
      lbl.style.cssText = [
        "position:fixed", "z-index:2147483647", "pointer-events:none",
        "background:oklch(0.8868 0.1815 95.265)", "color:oklch(0.145 0 0)",
        "font:700 10px/1 ui-sans-serif,sans-serif",
        "padding:3px 8px", "border-radius:999px", "white-space:nowrap", "display:none",
      ].join(";");
      doc.body.appendChild(lbl);
      pickLabelRef.current = lbl;
    }
  }, [frameDoc]);

  const posRing = useCallback((target: Element) => {
    if (!pickRingRef.current || !target) return;
    const r = target.getBoundingClientRect();
    const p = 3;
    const ring = pickRingRef.current;
    const lbl = pickLabelRef.current;
    ring.style.left = `${r.left - p}px`;
    ring.style.top = `${r.top - p}px`;
    ring.style.width = `${r.width + p * 2}px`;
    ring.style.height = `${r.height + p * 2}px`;
    ring.style.display = "block";
    if (lbl) {
      lbl.style.left = `${r.left - p}px`;
      lbl.style.top = `${Math.max(0, r.top - p - 22)}px`;
      lbl.style.display = "block";
      const cls = [...target.classList]
        .filter((c) => /^[a-z]/.test(c) && !/^vte/.test(c))
        .slice(0, 2)
        .join(".");
      lbl.textContent = `${target.tagName.toLowerCase()}${cls ? "." + cls : ""} · ${Math.round(r.width)}×${Math.round(r.height)}`;
    }
  }, []);

  const cleanPick = useCallback(() => {
    const doc = frameDoc();
    if (doc) {
      if (pickStyleRef.current) { pickStyleRef.current.remove(); pickStyleRef.current = null; }
      if (pickRingRef.current) { pickRingRef.current.remove(); pickRingRef.current = null; }
      if (pickLabelRef.current) { pickLabelRef.current.remove(); pickLabelRef.current = null; }
    }
  }, [frameDoc]);

  // ── directHighlight ────────────────────────────────────────────────────────
  const directHighlight = useCallback((selector: string) => {
    const doc = frameDoc();
    const win = frameWin();
    if (!doc || !win) return;
    try {
      const target = doc.querySelector(selector);
      if (!target) return;
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      ensurePickUI();
      posRing(target);
    } catch {}
  }, [frameDoc, frameWin, ensurePickUI, posRing]);

  // ── Pick event handlers (stable refs) ─────────────────────────────────────
  const onPickHoverRef = useRef<((e: Event) => void) | null>(null);
  const onPickClickRef = useRef<((e: Event) => void) | null>(null);
  const onPickEscRef = useRef<((e: Event) => void) | null>(null);

  const attachPickListeners = useCallback(() => {
    const doc = frameDoc();
    if (!doc) return;
    if (onPickHoverRef.current) doc.addEventListener("mouseover", onPickHoverRef.current, true);
    if (onPickClickRef.current) doc.addEventListener("click", onPickClickRef.current, true);
    if (onPickEscRef.current) doc.addEventListener("keydown", onPickEscRef.current, true);
  }, [frameDoc]);

  const detachPickListeners = useCallback(() => {
    const doc = frameDoc();
    if (!doc) return;
    if (onPickHoverRef.current) doc.removeEventListener("mouseover", onPickHoverRef.current, true);
    if (onPickClickRef.current) doc.removeEventListener("click", onPickClickRef.current, true);
    if (onPickEscRef.current) doc.removeEventListener("keydown", onPickEscRef.current, true);
  }, [frameDoc]);

  // ── setPickingMode ─────────────────────────────────────────────────────────
  const setPickingMode = useCallback((on: boolean) => {
    setPicking(on);
    pickingRef.current = on;
    if (on) {
      const doc = frameDoc();
      if (doc) {
        ensurePickUI();
        attachPickListeners();
      }
      try { frameRef.current?.contentWindow?.postMessage({ type: "vtb:pick-mode", on: true }, "*"); } catch {}
    } else {
      detachPickListeners();
      if (pickStyleRef.current) { pickStyleRef.current.remove(); pickStyleRef.current = null; }
      try { frameRef.current?.contentWindow?.postMessage({ type: "vtb:pick-mode", on: false }, "*"); } catch {}
    }
  }, [frameDoc, ensurePickUI, attachPickListeners, detachPickListeners]);

  // ── Load helpers ───────────────────────────────────────────────────────────
  const loadComponents = useCallback(async () => {
    try {
      const data = await fetch(`${SERVER}/components`).then((r) => r.json());
      setComponents(data);
    } catch {}
  }, []);

  const loadDesignCtx = useCallback(async () => {
    try {
      const data = await fetch(`${SERVER}/design-context`).then((r) => r.json());
      setDesignCtx(data);
    } catch {}
  }, []);

  // ── loadApp ────────────────────────────────────────────────────────────────
  const loadApp = useCallback(async () => {
    if (!urlValue.trim()) return;
    setConnected(false);
    setSelectedEl(null);
    cleanPick();
    setPicking(false);

    try {
      await fetch(`${SERVER}/set-proxy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: urlValue.trim() }),
      });
    } catch {}

    if (frameRef.current) {
      frameRef.current.src = `${SERVER}/?_=${Date.now()}`;
    }
  }, [urlValue, cleanPick]);

  // ── applyChanges ───────────────────────────────────────────────────────────
  const applyChanges = useCallback(async () => {
    const entries = Object.entries(pendingPropsRef.current);
    const sel = selectedElRef.current?.selector;
    if (!sel || !entries.length) { showToast("Nothing to apply"); return; }

    if (sessionActive) {
      const newChanges = entries.map(([property, value]) => ({
        id: Date.now() + Math.random() + "",
        selector: sel,
        property,
        value,
        source: "inspector",
      }));
      setSessionChanges((prev) => [...prev, ...newChanges]);
      setPendingProps({});
      pendingPropsRef.current = {};
      applyPreview({});
      showToast(`Added ${entries.length} change(s) to session`);
      return;
    }

    let last: { success?: boolean; file?: string; error?: string } | null = null;
    for (const [property, value] of entries) {
      try {
        const r = await fetch(`${SERVER}/apply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ selector: sel, property, value }),
        });
        last = await r.json();
      } catch {
        showToast("Server error", 3000);
        return;
      }
    }
    if (last?.success) {
      showToast(`Saved ${entries.length} prop(s) -> ${last.file}`);
      setPendingProps({});
      pendingPropsRef.current = {};
      applyPreview({});
    } else {
      showToast("Error: " + (last?.error || "unknown"), 3500);
    }
  }, [sessionActive, applyPreview, showToast]);

  // ── Set up pick event handlers (once) ─────────────────────────────────────
  useEffect(() => {
    onPickHoverRef.current = (e: Event) => {
      const target = e.target as Element;
      if (target.id === "vte-ring" || target.id === "vte-label") return;
      posRing(target);
    };

    onPickClickRef.current = (e: Event) => {
      const mouseE = e as MouseEvent;
      const target = mouseE.target as Element;
      if (target.id === "vte-ring" || target.id === "vte-label") return;
      mouseE.preventDefault();
      mouseE.stopPropagation();

      const win = frameRef.current?.contentWindow;
      const doc = frameRef.current?.contentDocument;
      if (!win || !doc) return;

      const sel = bestSelector(target, doc);
      const cs = win.getComputedStyle(target);
      const r = target.getBoundingClientRect();

      const elInfo: ElementInfo = {
        selector: sel,
        tag: target.tagName.toLowerCase(),
        id: target.id || null,
        classes: [...target.classList].filter((c) => !/^vte/.test(c)),
        rect: { left: r.left, top: r.top, width: r.width, height: r.height },
        styles: {
          backgroundColor: cs.backgroundColor,
          color: cs.color,
          borderColor: cs.borderColor,
          borderWidth: cs.borderWidth,
          borderStyle: cs.borderStyle,
          borderRadius: cs.borderRadius,
          fontSize: cs.fontSize,
          fontWeight: cs.fontWeight,
          lineHeight: cs.lineHeight,
          letterSpacing: cs.letterSpacing,
          textAlign: cs.textAlign,
          textTransform: cs.textTransform,
          textDecorationLine: cs.textDecorationLine,
          paddingTop: cs.paddingTop,
          paddingRight: cs.paddingRight,
          paddingBottom: cs.paddingBottom,
          paddingLeft: cs.paddingLeft,
          marginTop: cs.marginTop,
          marginRight: cs.marginRight,
          marginBottom: cs.marginBottom,
          marginLeft: cs.marginLeft,
          gap: cs.gap,
          width: cs.width,
          height: cs.height,
          display: cs.display,
          flexDirection: cs.flexDirection,
          justifyContent: cs.justifyContent,
          alignItems: cs.alignItems,
          flexWrap: cs.flexWrap,
          position: cs.position,
          overflow: cs.overflow,
          opacity: cs.opacity,
          boxShadow: cs.boxShadow,
          textShadow: cs.textShadow,
          filter: cs.filter,
          backdropFilter: cs.backdropFilter,
          transform: cs.transform,
          transition: cs.transition,
          cursor: cs.cursor,
        },
      };

      setSelectedEl(elInfo);
      selectedElRef.current = elInfo;
      setPendingProps({});
      pendingPropsRef.current = {};
      setPickingMode(false);
    };

    onPickEscRef.current = (e: Event) => {
      if ((e as KeyboardEvent).key === "Escape") setPickingMode(false);
    };
  }, [posRing, setPickingMode]);

  // ── Bridge message listener ────────────────────────────────────────────────
  useEffect(() => {
    const handler = (evt: MessageEvent) => {
      const m = evt.data;
      if (!m?.type?.startsWith("vtb:")) return;
      switch (m.type) {
        case "vtb:ready":
          if (!connected) {
            setConnected(true);
            loadComponents();
            loadDesignCtx();
          }
          break;
        case "vtb:selected":
          if (!pickingRef.current) return;
          setSelectedEl(m.el);
          selectedElRef.current = m.el;
          setPendingProps({});
          pendingPropsRef.current = {};
          setPickingMode(false);
          break;
        case "vtb:pick-cancel":
          setPickingMode(false);
          break;
        case "vtb:pong":
          if (!connected) setConnected(true);
          break;
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [connected, loadComponents, loadDesignCtx, setPickingMode]);

  // ── Keyboard shortcut (P to pick) ─────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "p") {
        if (!connected) { showToast("Load an app first — enter URL and click Load"); return; }
        setPickingMode(!pickingRef.current);
      }
      if (e.key === "Escape" && pickingRef.current) setPickingMode(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [connected, setPickingMode, showToast]);

  // ── Frame onLoad ───────────────────────────────────────────────────────────
  const handleFrameLoad = useCallback(() => {
    const doc = frameDoc();
    if (!doc || !doc.body) {
      try { frameRef.current?.contentWindow?.postMessage({ type: "vtb:ping" }, "*"); } catch {}
      return;
    }

    setConnected(true);
    if (pickingRef.current) {
      setTimeout(() => {
        pickRingRef.current = null;
        pickLabelRef.current = null;
        pickStyleRef.current = null;
        ensurePickUI();
        attachPickListeners();
      }, 200);
    }
    loadComponents();
    loadDesignCtx();
  }, [frameDoc, ensurePickUI, attachPickListeners, loadComponents, loadDesignCtx]);

  // ── Zoom ───────────────────────────────────────────────────────────────────
  const setZoom = useCallback((z: number) => {
    const clamped = Math.max(0.25, Math.min(2, z));
    setZoomState(clamped);
  }, []);

  const fitZoom = useCallback(() => {
    const canvas = document.getElementById("canvas-wrap");
    if (!canvas) return;
    const z = Math.min(
      (canvas.clientWidth - 40) / 1280,
      (canvas.clientHeight - 40) / 800
    );
    setZoom(z);
  }, [setZoom]);

  // ── Stable onChange for TweakpaneInspector ────────────────────────────────
  const handleInspectorChange = useCallback((prop: string, val: string) => {
    const next = { ...pendingPropsRef.current, [prop]: val };
    setPendingProps(next);
    pendingPropsRef.current = next;
    applyPreview(next);
  }, [applyPreview]);

  // ── Bottom panel: variant cards ────────────────────────────────────────────
  const [bottomCompName, setBottomCompName] = useState("");
  const [variantCards, setVariantCards] = useState<
    Array<{ label: string; sub: string; tag?: string; classes?: string[] }>
  >([]);
  const [selectedCard, setSelectedCard] = useState<string | null>(null);

  const loadBottomForEl = useCallback((elInfo: ElementInfo) => {
    if (!components) return;
    const kebab = (s: string) => s.replace(/([A-Z])/g, (m) => "-" + m.toLowerCase()).replace(/^-/, "");
    const comp = components.find((c) =>
      elInfo.classes?.some(
        (cl) =>
          cl.toLowerCase().includes(c.name.toLowerCase()) ||
          cl.toLowerCase().includes(kebab(c.name))
      )
    );
    if (comp) loadBottomForComp(comp);
  }, [components]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadBottomForComp = useCallback((comp: Component) => {
    setBottomCompName(comp.name);
    const cvaInfo = designCtx?.components?.filter(
      (c) => c.type === "cva" && c.name === comp.name
    );

    fetch(`${SERVER}/component-classes?file=${encodeURIComponent(comp.file)}`)
      .then((r) => r.json())
      .then((data) => {
        const cards: typeof variantCards = [];
        if (cvaInfo?.length) {
          cvaInfo[0].variants?.forEach((variant) => {
            variant.options?.forEach((opt) => {
              cards.push({ label: opt, sub: `${variant.name}: ${opt}`, tag: variant.name });
            });
          });
        } else if (data.classUsages?.length) {
          data.classUsages.slice(0, 8).forEach((u: { tag: string; classes: string[] }) => {
            cards.push({ label: u.tag, sub: u.classes.slice(0, 4).join(" "), classes: u.classes, tag: u.tag });
          });
        }
        setVariantCards(cards);
      })
      .catch(() => setVariantCards([]));
  }, [designCtx]); // eslint-disable-line react-hooks/exhaustive-deps

  // Trigger bottom load when selectedEl or components changes
  useEffect(() => {
    if (selectedEl && components) loadBottomForEl(selectedEl);
  }, [selectedEl, components, loadBottomForEl]);

  // ── Design tab: load tokens ────────────────────────────────────────────────
  const loadTokens = useCallback(() => {
    setTokens(null);
    fetch(`${SERVER}/scan-tokens`)
      .then((r) => r.json())
      .then((data) => setTokens(data))
      .catch(() => setTokens({}));
  }, []);

  // ── Session: generate prompt ───────────────────────────────────────────────
  const [promptText, setPromptText] = useState("Click Generate...");

  const generatePrompt = useCallback(async () => {
    setPromptText("Scanning...");
    try {
      const ctx = designCtx || (await fetch(`${SERVER}/design-context`).then((r) => r.json()));
      const text = buildPrompt(sessionChanges, ctx);
      setPromptText(text);
      await navigator.clipboard.writeText(text).catch(() => {});
      showToast("Prompt copied to clipboard!", 2400);
    } catch {
      setPromptText("Error generating prompt");
    }
  }, [designCtx, sessionChanges, showToast]);

  // ── Left panel: DOM tree ───────────────────────────────────────────────────
  interface DOMNode {
    tag: string;
    sel: string;
    id: string | null;
    cls: string[];
    kids: DOMNode[];
    txt: string | null;
  }

  const buildDOMTree = useCallback((): DOMNode | null => {
    const doc = frameDoc();
    if (!doc?.body) return null;
    const SKIP = /^(script|style|noscript|meta|link|head|svg|path|g)$/i;
    function build(node: Element, depth: number): DOMNode | null {
      if (!node || depth > 5 || SKIP.test(node.tagName || "")) return null;
      const cls = [...(node.classList || [])].filter(
        (c) => /^[a-z]/.test(c) && !/^vte/.test(c)
      );
      const sel = node.id
        ? "#" + node.id
        : cls.length
          ? node.tagName.toLowerCase() + "." + cls[0]
          : node.tagName?.toLowerCase() || "";
      const txt =
        node.childNodes.length === 1 && node.firstChild?.nodeType === 3
          ? (node.firstChild as Text).textContent?.trim().slice(0, 40) ?? null
          : null;
      const kids = [...(node.children || [])]
        .map((c) => build(c, depth + 1))
        .filter(Boolean)
        .slice(0, 10) as DOMNode[];
      return { tag: node.tagName?.toLowerCase(), sel, id: node.id || null, cls: cls.slice(0, 3), kids, txt };
    }
    return build(doc.body, 0);
  }, [frameDoc]);

  // ── Status badge ──────────────────────────────────────────────────────────
  const statusLabel = connected ? "Connected" : "Not loaded";
  const statusVariant = connected ? "default" : "secondary";

  // ── DOM tree component ─────────────────────────────────────────────────────
  function DOMTree({ node, depth }: { node: DOMNode; depth: number }) {
    return (
      <div>
        <div
          className={`flex items-center gap-1 px-1.5 py-1 rounded-sm cursor-pointer text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors`}
          style={{ paddingLeft: `${depth * 10 + 6}px` }}
          onClick={() => directHighlight(node.sel)}
        >
          <span className="text-[9px] opacity-60">{node.kids?.length ? "▾" : "·"}</span>
          <span className="flex-1 truncate">{node.sel}</span>
          {node.txt && (
            <span className="text-[9px] bg-muted border border-border px-1 rounded shrink-0 truncate max-w-[60px]">
              {node.txt.slice(0, 16)}
            </span>
          )}
        </div>
        {(node.kids || []).map((k, i) => (
          <DOMTree key={i} node={k} depth={depth + 1} />
        ))}
      </div>
    );
  }

  const [domTree, setDomTree] = useState<DOMNode | null>(null);

  // ── Main render ────────────────────────────────────────────────────────────
  return (
    <TooltipProvider delayDuration={400}>
      <style>{TWEAKPANE_THEME}</style>
      <div className="h-screen w-screen flex flex-col overflow-hidden bg-background text-foreground">

        {/* ── Top bar ─────────────────────────────────────────────────────── */}
        <div className="h-[46px] bg-card border-b border-border flex items-center gap-2 px-3 shrink-0 z-10">
          <span className="text-[15px] font-extrabold text-primary mr-1 flex items-center gap-2">
            <i className="fa-solid fa-pen-ruler" />
            OpenTweaker
          </span>
          <Separator orientation="vertical" className="h-[22px]" />

          {/* URL bar */}
          <Input
            type="url"
            value={urlValue}
            onChange={(e) => setUrlValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") loadApp(); }}
            placeholder="http://localhost:5173"
            className="w-[320px] h-8 font-mono text-xs bg-background"
          />
          <Button size="sm" onClick={loadApp} className="h-8 shrink-0">
            Load →
          </Button>

          <Separator orientation="vertical" className="h-[22px]" />

          {/* Pick button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={picking ? "default" : "outline"}
                size="icon"
                className={`h-8 w-8 shrink-0 ${picking ? "animate-pulse" : ""}`}
                onClick={() => {
                  if (!connected) { showToast("Load an app first"); return; }
                  setPickingMode(!picking);
                }}
              >
                ⊕
              </Button>
            </TooltipTrigger>
            <TooltipContent>Pick element (P)</TooltipContent>
          </Tooltip>

          <Separator orientation="vertical" className="h-[22px]" />

          {/* Zoom controls */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setZoom(zoom - 0.1)}>−</Button>
            </TooltipTrigger>
            <TooltipContent>Zoom out</TooltipContent>
          </Tooltip>
          <span className="text-[11px] text-muted-foreground font-mono min-w-[38px] text-center">
            {Math.round(zoom * 100)}%
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setZoom(zoom + 0.1)}>+</Button>
            </TooltipTrigger>
            <TooltipContent>Zoom in</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-[10px] font-bold" onClick={fitZoom}>FIT</Button>
            </TooltipTrigger>
            <TooltipContent>Fit to canvas</TooltipContent>
          </Tooltip>

          <div className="flex-1" />

          {/* Status */}
          {/* Update banner */}
          {updateInfo?.behind && (
            <div className="flex items-center gap-1.5 bg-primary/10 border border-primary/30 rounded px-2 py-1 text-[10px] shrink-0">
              <span className="text-primary font-semibold">⬆ v{updateInfo.latest} available</span>
              <button
                disabled={updating}
                onClick={async () => {
                  setUpdating(true);
                  showToast("Pulling update… server will restart", 8000);
                  try {
                    const r = await fetch(`${SERVER}/update`, { method: "POST" });
                    if (r.ok) {
                      showToast("Updated! Reconnecting…", 4000);
                      // Poll until server comes back up
                      const poll = setInterval(async () => {
                        try {
                          await fetch(`${SERVER}/version`);
                          clearInterval(poll);
                          window.location.reload();
                        } catch {}
                      }, 1500);
                    } else {
                      const err = await r.json();
                      showToast(`Update failed: ${err.error}`, 4000);
                      setUpdating(false);
                    }
                  } catch {
                    showToast("Update failed — run: git pull && node server.cjs", 5000);
                    setUpdating(false);
                  }
                }}
                className="ml-1 bg-primary text-primary-foreground rounded px-2 py-0.5 text-[10px] font-semibold hover:opacity-90 disabled:opacity-50 cursor-pointer"
              >
                {updating ? "Updating…" : "Update"}
              </button>
            </div>
          )}

          <Badge variant={statusVariant} className="text-[10px] shrink-0">
            {statusLabel}
          </Badge>
        </div>

        {/* ── Workspace ───────────────────────────────────────────────────── */}
        <div className="flex-1 min-h-0 overflow-hidden flex">

            {/* LEFT SIDEBAR */}
            <div style={{ width: 260, minWidth: 200, maxWidth: 360, flexShrink: 0 }}>
              <div className="h-full bg-card border-r border-border flex flex-col">
                <Tabs
                  defaultValue="components"
                  className="flex-1 flex flex-col min-h-0"
                >
                  <TabsList className="w-full rounded-none border-b border-border bg-background/50 shrink-0 h-8">
                    <TabsTrigger value="components" className="flex-1 text-[10px] uppercase tracking-wider h-full rounded-none data-[state=active]:text-primary data-[state=active]:border-b-2 data-[state=active]:border-primary">
                      Components
                    </TabsTrigger>
                    <TabsTrigger
                      value="dom"
                      className="flex-1 text-[10px] uppercase tracking-wider h-full rounded-none data-[state=active]:text-primary data-[state=active]:border-b-2 data-[state=active]:border-primary"
                      onClick={() => setDomTree(buildDOMTree())}
                    >
                      DOM
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="components" className="flex-1 min-h-0 m-0 data-[state=active]:flex data-[state=active]:flex-col">
                    <div className="flex-1 overflow-y-auto min-h-0">
                      <div className="p-2">
                        {!components && (
                          <p className="text-muted-foreground text-[11px] text-center py-4">Loading components…</p>
                        )}
                        {components && !components.length && (
                          <p className="text-muted-foreground text-[11px] text-center py-4">No components found.</p>
                        )}
                        {components && components.length > 0 && (
                          <>
                            <p className="text-[10px] text-muted-foreground mb-2">{components.length} components</p>
                            {components.map((comp) => (
                              <div
                                key={comp.file}
                                className="px-2 py-1.5 rounded-sm cursor-pointer mb-0.5 border-l-2 border-transparent hover:bg-muted transition-colors group"
                                onClick={() => {
                                  const kebab = comp.name.replace(/([A-Z])/g, (m) => "-" + m.toLowerCase()).replace(/^-/, "");
                                  directHighlight(`.${kebab}`);
                                  loadBottomForComp(comp);
                                }}
                              >
                                <div className="text-[12px] font-semibold group-hover:text-foreground">{comp.name}</div>
                                <div className="text-[10px] text-muted-foreground font-mono truncate">{comp.file}</div>
                              </div>
                            ))}
                          </>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full mt-2 text-[11px] h-7"
                          onClick={() => { setComponents(null); loadComponents(); }}
                        >
                          ↺ Rescan
                        </Button>
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="dom" className="flex-1 min-h-0 m-0 data-[state=active]:flex data-[state=active]:flex-col">
                    <div className="flex-1 overflow-y-auto min-h-0">
                      <div className="p-1">
                        {!connected && (
                          <p className="text-muted-foreground text-[11px] text-center py-4">Load an app first.</p>
                        )}
                        {connected && !domTree && (
                          <p className="text-muted-foreground text-[11px] text-center py-4">Click DOM tab to build tree.</p>
                        )}
                        {connected && domTree && <DOMTree node={domTree} depth={0} />}
                      </div>
                    </div>
                  </TabsContent>
                </Tabs>
              </div>
            </div>

            {/* drag handle */}
            <div className="w-1 bg-border hover:bg-primary/40 cursor-col-resize shrink-0 transition-colors" />

            {/* CANVAS */}
            <div className="flex-1 min-w-0">
              <div className="h-full flex flex-col bg-[oklch(0.11_0_0)]">
                {/* Canvas toolbar */}
                <div className="flex items-center gap-2 px-3 py-1.5 bg-background border-b border-border shrink-0">
                  <span className="text-[10px] text-muted-foreground">Canvas</span>
                </div>

                {/* Canvas body */}
                <div
                  id="canvas-wrap"
                  className="flex-1 overflow-auto flex items-start justify-center p-5"
                >
                  <div
                    className="relative bg-white shrink-0 rounded-sm overflow-hidden"
                    style={{
                      width: 1280,
                      height: 800,
                      transform: `scale(${zoom})`,
                      transformOrigin: "top center",
                      boxShadow: "0 8px 40px oklch(0 0 0/.7), 0 0 0 1px oklch(1 0 0/.08)",
                    }}
                  >
                    {/* Pick overlay border (purely visual) */}
                    {picking && (
                      <div
                        className="absolute inset-0 z-10 pointer-events-none border-2 border-primary/60 animate-pulse"
                        style={{ display: "block" }}
                      />
                    )}

                    <iframe
                      ref={frameRef}
                      title="App Preview"
                      className="block border-none w-full h-full"
                      onLoad={handleFrameLoad}
                      style={{ cursor: picking ? "crosshair" : undefined }}
                    />

                    {/* Placeholder */}
                    {!connected && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-muted-foreground bg-[oklch(0.11_0_0)]">
                        <div className="text-[40px] opacity-30">⟡</div>
                        <p className="text-[13px] opacity-50">Enter a URL above and click <strong>Load →</strong></p>
                        <p className="text-[11px] opacity-40">The app will load in this canvas with element picking enabled.</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* drag handle */}
            <div className="w-1 bg-border hover:bg-primary/40 cursor-col-resize shrink-0 transition-colors" />

            {/* RIGHT SIDEBAR */}
            <div style={{ width: 320, minWidth: 240, maxWidth: 480, flexShrink: 0 }}>
              <div className="h-full bg-card border-l border-border flex flex-col">
                <Tabs defaultValue="inspect" className="flex-1 flex flex-col min-h-0">
                  <TabsList className="w-full rounded-none border-b border-border bg-background/50 shrink-0 h-8">
                    {["inspect", "design", "session"].map((tab) => (
                      <TabsTrigger
                        key={tab}
                        value={tab}
                        className="flex-1 text-[10px] uppercase tracking-wider h-full rounded-none data-[state=active]:text-primary data-[state=active]:border-b-2 data-[state=active]:border-primary"
                        onClick={() => {
                          if (tab === "design" && !tokens) loadTokens();
                        }}
                      >
                        {tab}
                      </TabsTrigger>
                    ))}
                  </TabsList>

                  {/* INSPECT TAB */}
                  <TabsContent value="inspect" className="flex-1 min-h-0 m-0 data-[state=active]:flex data-[state=active]:flex-col overflow-hidden">
                    <div className="flex-1 overflow-y-auto min-h-0">
                      <div className="p-2">
                        {/* Selector bar */}
                        <div
                          className={`rounded-sm px-2 py-1.5 mb-3 font-mono text-[12px] border ${selectedEl ? "border-primary/40 text-primary bg-primary/5" : "border-border text-muted-foreground italic"}`}
                        >
                          <input
                            type="text"
                            defaultValue={selectedEl?.selector || ""}
                            placeholder="Click ⊕ to pick an element"
                            className="bg-transparent border-none outline-none text-inherit font-inherit w-full"
                            onChange={(e) => { if (e.target.value.trim()) directHighlight(e.target.value.trim()); }}
                          />
                        </div>

                        {!selectedEl && (
                          <p className="text-muted-foreground text-[11px] text-center py-5 leading-7">
                            Use ⊕ in the toolbar (or press P)<br />
                            to pick any element on the canvas.
                          </p>
                        )}

                        {/* Tweakpane inspector */}
                        {selectedEl && (
                          <>
                            <TweakpaneInspector
                              elInfo={selectedEl}
                              onChange={handleInspectorChange}
                            />

                            {/* Action row */}
                            <div className="flex gap-2 pt-2 mt-2 border-t border-border">
                              <Button
                                variant="outline"
                                size="sm"
                                className="flex-1 text-[11px] h-7"
                                onClick={() => {
                                  setPendingProps({});
                                  pendingPropsRef.current = {};
                                  applyPreview({});
                                  showToast("Preview reset");
                                }}
                              >
                                Reset
                              </Button>
                              <Button
                                size="sm"
                                className="flex-[2] text-[11px] h-7"
                                onClick={applyChanges}
                              >
                                Apply to Source
                              </Button>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </TabsContent>

                  {/* DESIGN TAB */}
                  <TabsContent value="design" className="flex-1 min-h-0 m-0 data-[state=active]:flex data-[state=active]:flex-col overflow-hidden">
                    <div className="flex-1 overflow-y-auto min-h-0">
                      <div className="p-2">
                        {tokens === null && (
                          <p className="text-muted-foreground text-[11px] text-center py-4">Scanning tokens…</p>
                        )}
                        {tokens !== null && Object.keys(tokens).length === 0 && (
                          <p className="text-muted-foreground text-[11px] text-center py-4">No CSS custom properties or SCSS variables found.</p>
                        )}
                        {tokens !== null &&
                          ["colors", "typography", "spacing", "shadows", "radius", "motion", "other"].map((cat) => {
                            const list = (tokens as Record<string, Token[]>)[cat] || [];
                            if (!list.length) return null;
                            return (
                              <div key={cat} className="mb-4">
                                <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground pb-1.5 mb-2 border-b border-border">
                                  {cat} ({list.length})
                                </div>
                                {list.slice(0, 20).map((tok) => (
                                  <div key={tok.name} className="flex items-center gap-1.5 mb-1.5">
                                    <span
                                      className="font-mono text-[10px] text-muted-foreground flex-1 overflow-hidden text-ellipsis whitespace-nowrap"
                                      title={tok.name}
                                    >
                                      {tok.name}
                                    </span>
                                    {cat === "colors" && (
                                      <input
                                        type="color"
                                        className="w-[34px] h-7 p-0.5 rounded border border-border bg-background cursor-pointer shrink-0"
                                        defaultValue={toHex(tok.value) || "#000000"}
                                      />
                                    )}
                                    <Input
                                      defaultValue={tok.value}
                                      className="w-[110px] h-7 text-[12px] font-mono shrink-0"
                                    />
                                  </div>
                                ))}
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  </TabsContent>

                  {/* SESSION TAB */}
                  <TabsContent value="session" className="flex-1 min-h-0 m-0 data-[state=active]:flex data-[state=active]:flex-col overflow-hidden">
                    <div className="flex-1 overflow-y-auto min-h-0">
                      <div className="p-2">
                        {/* Record toggle */}
                        <div className="flex items-center gap-2 mb-3">
                          <span className={`text-[11px] flex-1 ${sessionActive ? "text-destructive" : "text-muted-foreground"}`}>
                            {sessionActive ? "🔴  Recording…" : "⚫  Session recording off"}
                          </span>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-[11px]"
                            onClick={() => {
                              setSessionActive(!sessionActive);
                              showToast(
                                !sessionActive ? "Recording — Apply buffers here" : "Stopped",
                                2200
                              );
                            }}
                          >
                            {sessionActive ? "Stop" : "Start Recording"}
                          </Button>
                        </div>

                        {!sessionChanges.length && (
                          <p className="text-muted-foreground text-[11px] text-center py-3">No changes recorded yet.</p>
                        )}

                        {sessionChanges.length > 0 && (
                          <>
                            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
                              Changes ({sessionChanges.length})
                            </div>

                            {/* Group by selector */}
                            {Array.from(
                              sessionChanges.reduce((map, ch) => {
                                if (!map.has(ch.selector)) map.set(ch.selector, []);
                                map.get(ch.selector)!.push(ch);
                                return map;
                              }, new Map<string, SessionChange[]>())
                            ).map(([sel, chs]) => (
                              <div key={sel} className="bg-background border border-border rounded-sm p-2 mb-1.5">
                                <div className="font-mono text-[11px] font-semibold text-primary mb-1 truncate" title={sel}>
                                  {sel}
                                </div>
                                {chs.map((ch) => (
                                  <div key={ch.id} className="flex gap-1 font-mono text-[10px] mt-0.5">
                                    <span className="text-muted-foreground">{ch.property}:</span>
                                    <span className="text-green-400">{ch.value}</span>
                                    <button
                                      className="ml-auto text-muted-foreground hover:text-destructive text-[13px] px-0.5 rounded"
                                      onClick={() =>
                                        setSessionChanges((prev) => prev.filter((x) => x.id !== ch.id))
                                      }
                                    >
                                      ×
                                    </button>
                                  </div>
                                ))}
                              </div>
                            ))}

                            <Button
                              variant="outline"
                              size="sm"
                              className="w-full mb-2 text-[11px] h-7"
                              onClick={() => setSessionChanges([])}
                            >
                              × Clear All
                            </Button>

                            <Button
                              size="sm"
                              className="w-full mb-2 text-[11px] h-7"
                              onClick={generatePrompt}
                            >
                              ⚡ Generate &amp; Copy Prompt
                            </Button>

                            <div className="w-full bg-background border border-border rounded-sm p-2 font-mono text-[10px] text-muted-foreground whitespace-pre-wrap resize-y min-h-[140px] overflow-auto">
                              {promptText}
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </TabsContent>
                </Tabs>
              </div>
            </div>
        </div>

        {/* ── Bottom panel: Component Variants ────────────────────────────── */}
        <div
          className={`bg-card border-t border-border shrink-0 flex flex-col transition-all duration-200 ${bottomOpen ? "h-[200px]" : "h-8"}`}
        >
          <button
            className="flex items-center gap-2 px-3 h-8 cursor-pointer border-b border-border text-[11px] font-semibold text-muted-foreground hover:text-foreground select-none w-full bg-transparent"
            onClick={() => setBottomOpen(!bottomOpen)}
          >
            <span className="flex-1 text-left">Component Variants</span>
            {bottomCompName && (
              <span className="text-[10px] text-muted-foreground">{bottomCompName}</span>
            )}
            <span
              className="text-[10px] transition-transform duration-200"
              style={{ transform: bottomOpen ? "rotate(0deg)" : "rotate(180deg)" }}
            >
              ▲
            </span>
          </button>

          {bottomOpen && (
            <div className="flex-1 overflow-x-auto overflow-y-hidden flex gap-2.5 p-2.5 items-start">
              {!variantCards.length && (
                <p className="text-muted-foreground text-[11px] self-center px-2">
                  Select a component on the canvas to preview its variants here.
                </p>
              )}
              {variantCards.map((card, i) => {
                const key = `${card.label}-${i}`;
                return (
                  <div
                    key={key}
                    className={`bg-background border rounded-lg shrink-0 overflow-hidden cursor-pointer w-[180px] transition-colors ${selectedCard === key ? "border-primary shadow-[0_0_0_1px_oklch(0.852_0.199_91.936)]" : "border-border hover:border-primary/60"}`}
                    onClick={() => {
                      setSelectedCard(key);
                      // Try to find + highlight a live element in the iframe matching this variant
                      const doc = frameDoc();
                      if (doc) {
                        let found: Element | null = null;
                        if (card.classes?.length) {
                          // classUsage-based: find element with all those classes
                          const sel = card.classes.map((c) => `.${CSS.escape(c)}`).join("");
                          try { found = doc.querySelector(sel); } catch {}
                        }
                        if (!found && card.tag && card.label) {
                          // CVA-based: look for element whose class contains the option name
                          const lbl = card.label.toLowerCase();
                          const allEls = Array.from(doc.querySelectorAll("*"));
                          found = allEls.find((el) =>
                            Array.from(el.classList).some((c) => c.toLowerCase().includes(lbl))
                          ) ?? null;
                        }
                        if (found) {
                          found.scrollIntoView({ behavior: "smooth", block: "center" });
                          ensurePickUI();
                          posRing(found);
                          showToast(`Jumped to: ${card.tag ? `${card.tag}="${card.label}"` : card.label}`, 1400);
                        } else {
                          showToast(`No live element found for "${card.label}" in the canvas`, 1800);
                        }
                      }
                    }}
                  >
                    {/* Mini preview: live element snapshot via CSS classes */}
                    <div className="h-[80px] bg-[oklch(0.08_0_0)] flex flex-col items-center justify-center gap-1 p-2">
                      <span className="text-primary text-[10px] font-mono font-bold">
                        {card.tag ? `${card.tag}=` : ""}<span className="text-foreground">"{card.label}"</span>
                      </span>
                      {card.classes && (
                        <span className="text-[8px] text-muted-foreground font-mono text-center leading-3 line-clamp-2 px-1">
                          {card.classes.slice(0, 3).join(" ")}
                        </span>
                      )}
                    </div>
                    <div className="p-[7px_9px] border-t border-border">
                      <div className="text-[11px] font-semibold truncate">{card.label}</div>
                      <div className="font-mono text-[9px] text-muted-foreground mt-0.5 truncate">{card.sub}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Toast ───────────────────────────────────────────────────────── */}
        {toast && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-card border border-primary/40 text-foreground px-[18px] py-2 rounded-sm text-[12px] z-[99999] shadow-xl whitespace-nowrap pointer-events-none">
            {toast}
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
