window.__ModuleLoader__.load({
	id: "dsh-escalation-policy",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_jsx_runtime = require("react/jsx-runtime");
		let _deepseek_ai_dsh_client_store = require("@deepseek-ai/dsh-client-store");
		//#region \0dsh-css:C:\Users\00089093\IimaguestProjects\dsh-escalation-policy\src\client\EscalationPolicySelect.module.css.mjs
		const css$1 = "._36Uu8q_trigger{width:28px;height:28px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;border-radius:24px;outline:none;justify-content:center;align-items:center;padding:0;display:inline-flex}._36Uu8q_trigger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}._36Uu8q_trigger:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}._36Uu8q_trigger:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}._36Uu8q_triggerIcon{flex:none;display:inline-flex}._36Uu8q_triggerIcon svg{width:14px;height:14px}";
		const tagId$1 = "dsh-escalation-policy/EscalationPolicySelect.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$1) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-escalation-policy";
			tag.dataset.pluginCss = tagId$1;
			tag.textContent = css$1;
			document.head.appendChild(tag);
		}
		var EscalationPolicySelect_module_css_default = {
			"trigger": "_36Uu8q_trigger",
			"triggerIcon": "_36Uu8q_triggerIcon"
		};
		//#endregion
		//#region src/client/EscalationPolicySelect.tsx
		const shieldOutline = "M8.20554 0.899994L14.7901 3.36857V7.01026C14.7901 12 11.0466 14.2103 8.20554 15.3C5.36446 14.2103 1.62012 12 1.62012 7.01026V3.36857L8.20554 0.899994Z";
		/** Shield glyphs (design set 1556 family): plain = ask, slash = auto deny, check = always allow. */
		const policyGlyphs = {
			ask: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				width: "16",
				height: "16",
				viewBox: "0 0 16 16",
				fill: "none",
				"aria-hidden": true,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: shieldOutline,
					stroke: "currentColor",
					strokeWidth: "1.31831",
					strokeLinejoin: "round"
				})
			}),
			deny: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: "16",
				height: "16",
				viewBox: "0 0 16 16",
				fill: "none",
				"aria-hidden": true,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: shieldOutline,
					stroke: "currentColor",
					strokeWidth: "1.31831",
					strokeLinejoin: "round"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M3.5 12.5L12.5 3.5",
					stroke: "currentColor",
					strokeWidth: "1.4",
					strokeLinecap: "round"
				})]
			}),
			allow: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: "16",
				height: "16",
				viewBox: "0 0 16 16",
				fill: "none",
				"aria-hidden": true,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: shieldOutline,
					stroke: "currentColor",
					strokeWidth: "1.31831",
					strokeLinejoin: "round"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M5.2 8L7.1 9.9L10.9 6.1",
					stroke: "currentColor",
					strokeWidth: "1.4",
					strokeLinecap: "round",
					strokeLinejoin: "round"
				})]
			})
		};
		/** Locale key for one escalation policy option (the host names stay English). */
		const OPTION_LABEL = {
			ask: "option.ask",
			deny: "option.deny",
			allow: "option.allow"
		};
		function EscalationPolicySelect({ value, locked, command, t }) {
			const [open, setOpen] = (0, react.useState)(false);
			const [busy, setBusy] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				if (!locked) return;
				setOpen(false);
			}, [locked]);
			if (value === void 0) return null;
			const current = value.options.find((option) => option.value === value.currentValue);
			const items = value.options.map((option) => ({
				id: option.value,
				label: t(OPTION_LABEL[option.value]),
				icon: policyGlyphs[option.value]
			}));
			const submit = (id) => {
				setBusy(true);
				command(`/escalation ${id}`).catch(() => false).finally(() => {
					setBusy(false);
				});
			};
			const choose = (id) => {
				setOpen(false);
				if (id === value.currentValue) return;
				submit(id);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Menu, {
				open,
				items,
				selectedId: value.currentValue,
				onSelect: choose,
				onClose: () => {
					setOpen(false);
				},
				side: "top",
				anchor: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: EscalationPolicySelect_module_css_default.trigger,
					"aria-label": t("access", { name: current?.name ?? value.currentValue }),
					title: current?.name,
					disabled: locked || busy,
					onClick: () => {
						setOpen(!open);
					},
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: EscalationPolicySelect_module_css_default.triggerIcon,
						"aria-hidden": true,
						children: policyGlyphs[value.currentValue]
					})
				})
			});
		}
		/**
		* The registered composer-row entry: bridges the framework projection seat,
		* the session-locked lifecycle flag, and the injected command executor into
		* the plain presentation component. Renders nothing while the `escalation`
		* projection is absent (escalation capability not composed).
		* @param props - the standard kit, the injected command executor, and the locale seat.
		*/
		function EscalationPolicyEntry({ useProjection, useSession, sessionId, command, t }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(EscalationPolicySelect, {
				value: useProjection("escalation"),
				locked: useSession((snapshot) => snapshot)?.removed ?? true,
				command: (line) => command(line),
				t
			});
		}
		//#endregion
		//#region \0dsh-css:C:\Users\00089093\IimaguestProjects\dsh-escalation-policy\src\client\EscalationPolicyRow.module.css.mjs
		const css = ".-hA1Yq_row{border-bottom:1px solid var(--dsw-alias-border-l2);align-items:center;gap:8px;padding:16px 0;display:flex}.-hA1Yq_rowText{flex-direction:column;flex:1;gap:4px;min-width:0;padding-right:48px;display:flex}.-hA1Yq_title{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:400;line-height:22px}.-hA1Yq_desc{color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:400;line-height:18px}.-hA1Yq_selector{background:var(--dsw-alias-bg-module-platform);height:36px;font:inherit;color:var(--dsw-alias-label-primary);cursor:pointer;border:none;border-radius:18px;align-items:center;gap:12px;padding:0 14px;font-size:14px;line-height:22px;display:inline-flex}.-hA1Yq_selector:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}.-hA1Yq_selector:disabled{cursor:default}.-hA1Yq_chevron{flex:none}";
		const tagId = "dsh-escalation-policy/EscalationPolicyRow.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-escalation-policy";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var EscalationPolicyRow_module_css_default = {
			"chevron": "-hA1Yq_chevron",
			"desc": "-hA1Yq_desc",
			"row": "-hA1Yq_row",
			"rowText": "-hA1Yq_rowText",
			"selector": "-hA1Yq_selector",
			"title": "-hA1Yq_title"
		};
		//#endregion
		//#region src/client/EscalationPolicyRow.tsx
		/**
		* Escalation preference row: the default escalation-policy for subsequently
		* created sessions. Current-session switches remain on the composer shield
		* icon (`/escalation`); this row writes the host `escalation` settings
		* namespace through the shared describe mirror.
		*/
		/**
		* Render the new-session escalation-policy default selector.
		* @param props - composed slot props.
		* @returns the row, or null when the host does not expose escalation settings.
		*/
		function EscalationPolicyRow({ load, select, useEscalationPolicy, t }) {
			const state = useEscalationPolicy((snapshot) => snapshot);
			const [open, setOpen] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				load();
			}, [load]);
			(0, react.useEffect)(() => {
				if (state.writable && state.status !== "unavailable") return;
				setOpen(false);
			}, [state.status, state.writable]);
			if (state.status === "unavailable") return null;
			const selected = state.options.find((option) => option.id === state.currentValue);
			const busy = state.status === "loading" || state.status === "saving";
			const label = selected?.label ?? (busy ? t("loading") : t("unavailable"));
			const description = state.error ?? t("description");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: EscalationPolicyRow_module_css_default.row,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: EscalationPolicyRow_module_css_default.rowText,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: EscalationPolicyRow_module_css_default.title,
						children: t("title")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: EscalationPolicyRow_module_css_default.desc,
						role: state.error === null ? void 0 : "alert",
						children: description
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Menu, {
					open,
					onClose: () => {
						setOpen(false);
					},
					items: state.options.map((option) => ({
						id: option.id,
						label: option.label
					})),
					selectedId: state.currentValue,
					onSelect: (id) => {
						setOpen(false);
						if (id === state.currentValue) return;
						select(id);
					},
					align: "end",
					portal: true,
					anchor: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: EscalationPolicyRow_module_css_default.selector,
						"aria-haspopup": "menu",
						"aria-expanded": open,
						disabled: busy || !state.writable || state.options.length === 0,
						onClick: () => {
							setOpen((value) => !value);
						},
						children: [label, /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutline14, { className: EscalationPolicyRow_module_css_default.chevron })]
					})
				})]
			});
		}
		//#endregion
		//#region src/client/settings-store.ts
		/** Escalation's settings namespace on the host wire. */
		const ESCALATION_SETTINGS_NS = "escalation";
		function titleCase(value) {
			return value.charAt(0).toUpperCase() + value.slice(1);
		}
		/**
		* Read the dynamic policy enum encoded by the host's `defaultPolicy` schema.
		* @param view - escalation namespace descriptor.
		* @param schema - settings schema operations.
		* @returns current value and selectable options.
		*/
		function escalationDefaultOf(view, schema) {
			const value = view.value?.defaultPolicy;
			if (typeof value !== "string") throw new Error("escalation settings has no defaultPolicy value");
			const node = schema.nodeAtPath(schema.rehydrate(view.schema), ["defaultPolicy"]);
			if (node === void 0) throw new Error("escalation settings schema has no defaultPolicy field");
			const options = (node.type === "union" ? node.list ?? [] : [node]).flatMap((candidate) => {
				const choice = candidate;
				if (choice.type !== "const" || typeof choice.value !== "string") return [];
				const described = choice.meta?.description;
				return [{
					id: choice.value,
					label: typeof described === "string" && described.length > 0 ? described : titleCase(choice.value)
				}];
			});
			if (options.length === 0 || !options.some((option) => option.id === value)) throw new Error("escalation settings schema does not advertise its current policy");
			return {
				currentValue: value,
				options
			};
		}
		/** Controller deriving the row from the shared mirror and writing the default through it. */
		var EscalationPolicySettingsController = class {
			describeFace;
			ctx;
			schema;
			/** Row snapshot consumed through a bound selector hook. */
			store = (0, _deepseek_ai_dsh_client_store.createSnapshotStore)({
				status: "idle",
				error: null,
				writable: false,
				currentValue: "",
				options: [],
				revision: 0
			});
			following;
			saving = false;
			disposed = false;
			/**
			* @param describeFace - the shared mirror's read/fold face (descriptor and schema source).
			* @param ctx - the row plugin's context, whose `remote.settings` namespace
			* carries the `defaultPolicy` write.
			* @param schema - settings-owned schema operations.
			*/
			constructor(describeFace, ctx, schema) {
				this.describeFace = describeFace;
				this.ctx = ctx;
				this.schema = schema;
			}
			/**
			* Begin following the mirror (idempotent) and reflect its current answer.
			* @returns settlement once the snapshot reflects the mirror.
			*/
			async load() {
				if (this.disposed) return;
				this.following ??= this.describeFace.subscribe(() => {
					this.derive();
				});
				this.store.update((state) => {
					state.status = "loading";
					state.error = null;
				});
				await this.describeFace.ensure();
				this.derive();
			}
			/**
			* Persist one policy as the default for subsequently created sessions.
			* A selection made while one is already saving is ignored — the row's
			* control is disabled during the save.
			* @param policy - advertised policy key.
			* @returns nothing; {@link store} carries success or failure.
			*/
			async select(policy) {
				const state = this.store.getSnapshot();
				const view = this.describeFace.getSnapshot().view?.namespaces.find((entry) => entry.ns === ESCALATION_SETTINGS_NS);
				if (view === void 0 || !state.writable || this.saving) return;
				this.saving = true;
				this.store.update((draft) => {
					draft.status = "saving";
					draft.error = null;
				});
				let response;
				try {
					response = await this.ctx.remote.settings.mutate(ESCALATION_SETTINGS_NS, [{
						op: "set",
						path: ["defaultPolicy"],
						value: policy
					}], view.revision);
				} finally {
					this.saving = false;
				}
				if (this.disposed) return;
				if (!response.ok) {
					this.fail(response.error);
					return;
				}
				this.describeFace.acceptView(response.value);
			}
			/** Stop following the mirror; later publishes leave the snapshot alone. */
			dispose() {
				this.disposed = true;
				this.following?.();
				this.following = void 0;
			}
			derive() {
				if (this.disposed || this.saving) return;
				const mirrored = this.describeFace.getSnapshot();
				if (mirrored.status === "unavailable") {
					this.store.update((state) => {
						state.status = "unavailable";
						state.writable = false;
						state.currentValue = "";
						state.options = [];
					});
					return;
				}
				if (mirrored.view === void 0) {
					if (mirrored.error !== null) this.fail(new Error(mirrored.error));
					return;
				}
				const view = mirrored.view.namespaces.find((entry) => entry.ns === ESCALATION_SETTINGS_NS);
				if (view === void 0) {
					this.store.update((state) => {
						state.status = "unavailable";
						state.writable = false;
						state.currentValue = "";
						state.options = [];
					});
					return;
				}
				try {
					const resolved = escalationDefaultOf(view, this.schema);
					const { writable } = mirrored.view;
					this.store.update((state) => {
						state.status = "ready";
						state.error = null;
						state.writable = writable;
						state.currentValue = resolved.currentValue;
						state.options = resolved.options;
						state.revision = view.revision;
					});
				} catch (error) {
					this.fail(error);
				}
			}
			fail(error) {
				this.store.update((state) => {
					state.status = "error";
					state.error = error instanceof Error ? error.message : String(error);
				});
			}
		};
		//#endregion
		//#region src/client/settings-locales.ts
		/** `settings.escalation` namespace dictionaries (the Escalation row's copy). */
		/** Simplified Chinese dictionary (the key-set source of truth). */
		const settingsZh = {
			"title": "升级权限",
			"description": "选择新会话的默认升级权限模式",
			"loading": "加载中",
			"unavailable": "不可用"
		};
		/** English dictionary, checked complete against the zh key set. */
		const settingsEn = {
			"title": "Escalation",
			"description": "Choose the default escalation mode for new sessions",
			"loading": "Loading",
			"unavailable": "Unavailable"
		};
		//#endregion
		//#region src/client/locales.ts
		/** `escalation` namespace dictionaries (the composer shield + settings row copy). */
		/** Simplified Chinese dictionary (the key-set source of truth). */
		const zh = {
			"access": "升级策略，当前：{name}",
			"option.ask": "询问升级",
			"option.deny": "自动拒绝",
			"option.allow": "始终允许"
		};
		/** English dictionary, checked complete against the zh key set. */
		const en = {
			"access": "Escalation mode, current: {name}",
			"option.ask": "Ask escalation",
			"option.deny": "Auto deny",
			"option.allow": "Always allow"
		};
		//#endregion
		//#region src/client/index.ts
		/** Dictionary namespace owned by this plugin. */
		const NS = "escalation";
		/** Settings row namespace owned by this plugin. */
		const SETTINGS_NS = "settings.escalation";
		/** Required services (cordis fiber inject). */
		const inject = [
			"slots",
			"sessions",
			"locale",
			"remote",
			"remote.settings",
			"settingsScope",
			"settingsSchema"
		];
		/**
		* Client plugin body: register the composer shield entry over the escalation
		* projection.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "escalation: dictionaries");
			ctx.effect(() => ctx.locale.register(SETTINGS_NS, {
				zh: settingsZh,
				en: settingsEn
			}), "escalation: settings row dictionaries");
			const sessions = ctx.sessions;
			ctx.slots.inject("conversation.input.left", () => ctx.slots.register({
				name: "conversation.input.left",
				id: "escalation",
				order: 0,
				locale: NS,
				inject: (sessionId) => ({ command: async (line) => {
					const face = sessions.binding(sessionId)?.session;
					if (face === void 0) return false;
					const result = await face.command(line);
					return result.ok === true && result.value?.matched === true;
				} })
			}, EscalationPolicyEntry));
			const controller = new EscalationPolicySettingsController(ctx.settingsScope.describe(), ctx, ctx.settingsSchema);
			const load = () => controller.load();
			const select = (policy) => controller.select(policy);
			const injected = () => ({
				hooks: { escalationPolicy: controller.store },
				load,
				select
			});
			ctx.effect(() => () => {
				controller.dispose();
			}, "escalation: settings row directory");
			ctx.slots.inject("settings.general.item", () => ctx.slots.register({
				name: "settings.general.item",
				id: "escalation",
				order: -10,
				locale: SETTINGS_NS,
				inject: injected
			}, EscalationPolicyRow));
		}
		//#endregion
		exports.EscalationPolicyEntry = EscalationPolicyEntry;
		exports.EscalationPolicyRow = EscalationPolicyRow;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map