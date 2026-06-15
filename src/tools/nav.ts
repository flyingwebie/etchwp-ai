import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toolError } from "../errors.ts";
import { envelope, registerTool, runRead, runWrite, type ToolContext } from "../tool-kit.ts";

/** Navigation actions that reload/replace the page context (dirty-guarded). */
const CONTEXT_CHANGING = new Set(["open_post", "open_template", "go_to"]);

export function registerNavTools(server: McpServer, ctx: ToolContext): void {
  registerTool(
    server,
    ctx,
    "etch_nav",
    "Navigate the Etch builder. Actions: get_current_place, get_places (enumerate valid targets at runtime — don't hardcode), go_to {place}, open_post {postId}, open_template {templateId}, list_posts {postType?} (NO pagination upstream — for big sites prefer the wp_content sidecar when configured), list_templates, exit_to_wordpress (requires confirm: true — DESTROYS the builder session and this bridge). open_post/open_template/go_to are DIRTY-GUARDED: they fail with E_UNSAVED_CHANGES when buffered changes exist unless discard: true; navigation makes all previous block/style ids stale — re-read the tree after.",
    {
      action: z.enum([
        "get_current_place",
        "get_places",
        "go_to",
        "open_post",
        "open_template",
        "list_posts",
        "list_templates",
        "exit_to_wordpress",
      ]),
      place: z.string().optional().describe("go_to: from get_places (builder/templates/…)"),
      postId: z.number().int().optional(),
      templateId: z.number().int().optional(),
      postType: z.string().optional().describe("list_posts: WP post type"),
      discard: z
        .boolean()
        .optional()
        .describe("context-changing actions: true = knowingly discard unsaved buffered changes"),
      confirm: z.boolean().optional().describe("exit_to_wordpress: must be true"),
    },
    async (args) => {
      const action = args.action as string;

      if (CONTEXT_CHANGING.has(action) || action === "exit_to_wordpress") {
        if (ctx.dirty.isDirty() && args.discard !== true) {
          throw toolError(
            "E_UNSAVED_CHANGES",
            `'${action}' reloads the page context and would silently destroy ${ctx.dirty.snapshot().page + ctx.dirty.snapshot().componentEdit} unsaved buffered change(s).`,
          );
        }
      }

      const navigate = async (method: string, callArgs: unknown[]) => {
        const run = () =>
          runWrite(ctx, "navigation", method, callArgs, { dirty: null, countMutation: false });
        const result = ctx.bridge.expectNavigation
          ? await ctx.bridge.expectNavigation(run)
          : await run();
        const discarded = ctx.dirty.isDirty();
        ctx.dirty.reset();
        ctx.componentEditMode = false;
        return envelope(ctx, result, {
          hint: `${discarded ? "Unsaved buffered changes were DISCARDED (discard: true). " : ""}Page context changed — previous block/style ids are stale; re-read with etch_blocks_read get_tree.`,
        });
      };

      switch (action) {
        case "get_current_place":
          return envelope(ctx, await runRead(ctx, "navigation", "getCurrentPlace"));
        case "get_places":
          return envelope(ctx, await runRead(ctx, "navigation", "getPlaces"));
        case "go_to": {
          const place = args.place;
          if (typeof place !== "string" || !place.length)
            throw toolError("E_VALIDATION", "'go_to' requires 'place' (see get_places)");
          return navigate("goTo", [place]);
        }
        case "open_post": {
          if (typeof args.postId !== "number")
            throw toolError("E_VALIDATION", "'open_post' requires numeric 'postId'");
          return navigate("openPostAsync", [args.postId]);
        }
        case "open_template": {
          if (typeof args.templateId !== "number")
            throw toolError("E_VALIDATION", "'open_template' requires numeric 'templateId'");
          return navigate("openTemplateAsync", [args.templateId]);
        }
        case "list_posts":
          return envelope(
            ctx,
            await runRead(
              ctx,
              "navigation",
              "listPostsAsync",
              args.postType ? [args.postType] : [],
            ),
            {
              hint: "Unpaginated upstream — on big sites prefer wp_content (sidecar) if configured.",
            },
          );
        case "list_templates":
          return envelope(ctx, await runRead(ctx, "navigation", "listTemplatesAsync"));
        case "exit_to_wordpress": {
          if (args.confirm !== true) {
            throw toolError(
              "E_VALIDATION",
              "exit_to_wordpress navigates to wp-admin and DESTROYS the builder session (and this bridge). Retry with confirm: true if that is really what you want.",
            );
          }
          const result = await runWrite(ctx, "ui", "exitToWordPress", [], {
            dirty: null,
            countMutation: false,
          });
          ctx.dirty.reset();
          return envelope(ctx, result, {
            hint: "Builder session ended — the bridge is detached. Re-open the builder in Chrome to continue.",
          });
        }
        default:
          throw toolError("E_VALIDATION", `unknown action '${action}'`);
      }
    },
  );

  registerTool(
    server,
    ctx,
    "etch_ui",
    "Builder UI chrome controls (persisted LOCALLY per browser, never dirty). Actions: get_color_scheme / set_color_scheme {scheme: light|dark} / toggle_color_scheme, is_interface_hidden / set_interface_hidden {hidden} / toggle_interface (distraction-free mode — also useful before etch_screenshot for clean captures).",
    {
      action: z.enum([
        "get_color_scheme",
        "set_color_scheme",
        "toggle_color_scheme",
        "is_interface_hidden",
        "set_interface_hidden",
        "toggle_interface",
      ]),
      scheme: z.enum(["light", "dark"]).optional(),
      hidden: z.boolean().optional(),
    },
    async (args) => {
      const localUi = { persistence: "local-ui" as const };
      const write = (method: string, callArgs: unknown[]) =>
        runWrite(ctx, "ui", method, callArgs, { dirty: null, countMutation: false });
      switch (args.action) {
        case "get_color_scheme":
          return envelope(ctx, await runRead(ctx, "ui", "getColorScheme"), localUi);
        case "set_color_scheme": {
          if (!args.scheme) throw toolError("E_VALIDATION", "'set_color_scheme' requires 'scheme'");
          return envelope(ctx, await write("setColorScheme", [args.scheme]), localUi);
        }
        case "toggle_color_scheme":
          return envelope(ctx, await write("toggleColorScheme", []), localUi);
        case "is_interface_hidden":
          return envelope(ctx, await runRead(ctx, "ui", "isInterfaceHidden"), localUi);
        case "set_interface_hidden": {
          if (typeof args.hidden !== "boolean")
            throw toolError("E_VALIDATION", "'set_interface_hidden' requires boolean 'hidden'");
          return envelope(ctx, await write("setInterfaceHidden", [args.hidden]), localUi);
        }
        case "toggle_interface":
          return envelope(ctx, await write("toggleInterface", []), localUi);
        default:
          throw toolError("E_VALIDATION", `unknown action '${String(args.action)}'`);
      }
    },
  );

  registerTool(
    server,
    ctx,
    "etch_history",
    "Undo/redo — the SAME stack as the builder UI; scripted mutations land on it automatically, and undo/redo do NOT adjust the dirty counters (they count AI-initiated calls, a lower bound). Actions: undo, redo (void — guard with can_undo/can_redo, there is no success signal), can_undo, can_redo, checkpoint (record a marker before a risky batch), rollback (undo every AI mutation since the checkpoint — BEST-EFFORT: manual edits made in the builder meanwhile share the stack and get reverted too; immediate-persistence writes (stylesheets/components/fields) are counted but their post-undo persisted state is undocumented upstream).",
    {
      action: z.enum(["undo", "redo", "can_undo", "can_redo", "checkpoint", "rollback"]),
    },
    async (args) => {
      switch (args.action) {
        case "undo":
          return envelope(
            ctx,
            await runWrite(ctx, "history", "undo", [], { dirty: null, countMutation: false }),
            {
              hint: "undo() returns void — verify the result via etch_blocks_read or can_undo.",
            },
          );
        case "redo":
          return envelope(
            ctx,
            await runWrite(ctx, "history", "redo", [], { dirty: null, countMutation: false }),
          );
        case "can_undo":
          return envelope(ctx, await runRead(ctx, "history", "canUndo"));
        case "can_redo":
          return envelope(ctx, await runRead(ctx, "history", "canRedo"));
        case "checkpoint": {
          ctx.checkpointAt = ctx.mutations.value();
          return envelope(
            ctx,
            { checkpoint: ctx.checkpointAt },
            {
              hint: "Marker recorded. etch_history rollback will undo every AI mutation made after this point.",
            },
          );
        }
        case "rollback": {
          if (ctx.checkpointAt === null) {
            throw toolError(
              "E_VALIDATION",
              "No checkpoint recorded — call etch_history checkpoint before the batch you may want to roll back.",
            );
          }
          const requested = ctx.mutations.since(ctx.checkpointAt);
          const immediates = [...new Set(ctx.mutations.immediateSince(ctx.checkpointAt))];
          let performed = 0;
          let stoppedBecause: string | null = null;
          for (let i = 0; i < requested; i++) {
            const can = await runRead(ctx, "history", "canUndo");
            if (can !== true) {
              stoppedBecause = "undo_stack_exhausted";
              break;
            }
            await runWrite(ctx, "history", "undo", [], { dirty: null, countMutation: false });
            performed += 1;
          }
          ctx.checkpointAt = null;
          return envelope(
            ctx,
            {
              requested,
              performed,
              stoppedBecause,
              immediateDomainsSinceCheckpoint: immediates,
            },
            {
              hint:
                (immediates.length
                  ? `Immediate-persistence domains (${immediates.join(", ")}) were mutated since the checkpoint — their persisted state after undo is UNDOCUMENTED upstream; verify in the builder. `
                  : "") +
                "Manual edits made in the builder during the batch share the undo stack and were reverted too. Dirty counters are NOT adjusted by rollback.",
            },
          );
        }
        default:
          throw toolError("E_VALIDATION", `unknown action '${String(args.action)}'`);
      }
    },
  );
}
