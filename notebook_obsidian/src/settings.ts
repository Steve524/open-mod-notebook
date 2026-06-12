// Portions derived from SurfSense (https://github.com/MODSetter/SurfSense), Apache-2.0; modified for Open Notebook.
import {
	type App,
	type ButtonComponent,
	Notice,
	Platform,
	PluginSettingTab,
	Setting,
	setIcon,
} from "obsidian";
import { AuthError } from "./api-client";
import { AttachmentsConfirmModal } from "./attachments-confirm-modal";
import { normalizeFolder, parseExcludePatterns } from "./excludes";
import { FolderSuggestModal } from "./folder-suggest-modal";
import type NotebookSyncPlugin from "./main";
import { STATUS_VISUALS } from "./status-visuals";
import type { SearchSpace } from "./types";

/** Plugin settings tab. */

export class NotebookSettingTab extends PluginSettingTab {
	private readonly plugin: NotebookSyncPlugin;
	private searchSpaces: SearchSpace[] = [];
	private loadingSpaces = false;
	private connectionIndicator: HTMLElement | null = null;
	private readonly onStatusChange = (): void => this.updateConnectionIndicator();

	constructor(app: App, plugin: NotebookSyncPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		this.plugin.onStatusChange(this.onStatusChange);

		const settings = this.plugin.settings;

		this.renderConnectionHeading(containerEl);

		new Setting(containerEl)
			.setName("Server URL")
			.setDesc(
				"Your Open Notebook backend URL (e.g. http://localhost:5055).",
			)
			.addText((text) =>
				text
					.setPlaceholder("http://localhost:5055")
					.setValue(settings.serverUrl)
					.onChange(async (value) => {
						const next = value.trim();
						const previous = this.plugin.settings.serverUrl;
						if (previous !== "" && next !== previous) {
							this.plugin.settings.searchSpaceId = null;
							this.plugin.settings.connectorId = null;
						}
						this.plugin.settings.serverUrl = next;
						await this.plugin.saveSettings();
					}),
			);

		let verifyButton: ButtonComponent | null = null;
		const updateVerifyDisabled = (): void => {
			verifyButton?.setDisabled(this.plugin.settings.apiToken.trim().length === 0);
		};

		new Setting(containerEl)
			.setName("API token")
			.setDesc(
				"Your Open Notebook API token — use your app password. Re-paste if you see an auth error.",
			)
			.addText((text) => {
				text.inputEl.type = "password";
				text.inputEl.autocomplete = "off";
				text.inputEl.spellcheck = false;
				text
					.setPlaceholder("Paste token")
					.setValue(settings.apiToken)
					.onChange(async (value) => {
						const next = value.trim();
						const previous = this.plugin.settings.apiToken;
						if (previous !== "" && next !== previous) {
							this.plugin.settings.searchSpaceId = null;
							this.plugin.settings.connectorId = null;
						}
						this.plugin.settings.apiToken = next;
						updateVerifyDisabled();
						await this.plugin.saveSettings();
						this.plugin.api.resetAuthBlock();
					});
			})
			.addButton((btn) => {
				verifyButton = btn;
				updateVerifyDisabled();
				btn.setButtonText("Verify").setCta().onClick(async () => {
					if (this.plugin.settings.apiToken.trim().length === 0) {
						new Notice("Open Notebook: paste an API token before verifying.");
						return;
					}
					btn.setDisabled(true);
					try {
						await this.plugin.api.verifyToken();
						new Notice("Open Notebook: token verified.");
						this.plugin.engine.refreshStatus({ force: true });
						await this.refreshSearchSpaces();
						this.display();
					} catch (err) {
						this.handleApiError(err);
					} finally {
						updateVerifyDisabled();
					}
				});
			});

		new Setting(containerEl)
			.setName("Notebook")
			.setDesc(
				"Which Open Notebook notebook this vault syncs into. Reload after changing your token.",
			)
			.addDropdown((drop) => {
				drop.addOption("", this.loadingSpaces ? "Loading…" : "Select a notebook");
				for (const space of this.searchSpaces) {
					drop.addOption(String(space.id), space.name);
				}
				if (settings.searchSpaceId !== null) {
					drop.setValue(String(settings.searchSpaceId));
				}
				drop.onChange(async (value) => {
					// searchSpaceId stays the internal name but holds an Open Notebook
					// notebook id (a string record id), not a number.
					this.plugin.settings.searchSpaceId = value || null;
					this.plugin.settings.connectorId = null;
					await this.plugin.saveSettings();
					if (this.plugin.settings.searchSpaceId !== null) {
						try {
							await this.plugin.engine.ensureConnected();
							await this.plugin.engine.maybeReconcile(true);
							new Notice("Open Notebook: vault connected.");
							this.display();
						} catch (err) {
							this.handleApiError(err);
						}
					}
				});
			})
			.addExtraButton((btn) =>
				btn
					.setIcon("refresh-ccw")
					.setTooltip("Reload notebooks")
					.onClick(async () => {
						await this.refreshSearchSpaces();
						this.display();
					}),
			);

		new Setting(containerEl).setName("Vault").setHeading();

		new Setting(containerEl)
			.setName("Sync interval")
			.setDesc(
				"How often to check for changes made outside Obsidian.",
			)
			.addDropdown((drop) => {
				const options: Array<[number, string]> = [
					[0, "Off"],
					[5, "5 minutes"],
					[10, "10 minutes"],
					[15, "15 minutes"],
					[30, "30 minutes"],
					[60, "60 minutes"],
					[120, "2 hours"],
					[360, "6 hours"],
					[720, "12 hours"],
					[1440, "24 hours"],
				];
				for (const [value, label] of options) {
					drop.addOption(String(value), label);
				}
				drop.setValue(String(settings.syncIntervalMinutes));
				drop.onChange(async (value) => {
					this.plugin.settings.syncIntervalMinutes = Number(value);
					await this.plugin.saveSettings();
					this.plugin.restartReconcileTimer();
				});
			});

		this.renderFolderList(
			containerEl,
			"Include folders",
			"Folders to sync (leave empty to sync entire vault).",
			settings.includeFolders,
			(next) => {
				this.plugin.settings.includeFolders = next;
			},
		);

		this.renderFolderList(
			containerEl,
			"Exclude folders",
			"Folders to exclude from sync (takes precedence over includes).",
			settings.excludeFolders,
			(next) => {
				this.plugin.settings.excludeFolders = next;
			},
		);

		new Setting(containerEl)
			.setName("Advanced exclude patterns")
			.setDesc(
				"Glob fallback for power users. One pattern per line, supports * and **. Lines starting with # are comments. Applied on top of the folder lists above.",
			)
			.addTextArea((area) => {
				area.inputEl.rows = 4;
				area
					.setPlaceholder(".trash\n_attachments\ntemplates/**")
					.setValue(settings.excludePatterns.join("\n"))
					.onChange(async (value) => {
						this.plugin.settings.excludePatterns = parseExcludePatterns(value);
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Include attachments")
			.setDesc(
				"Also sync non-Markdown files such as images and PDFs. Other file types are skipped.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(settings.includeAttachments)
					.onChange(async (value) => {
						const isEnabling =
							value && !this.plugin.settings.includeAttachments;
						if (isEnabling) {
							const confirmed = await new AttachmentsConfirmModal(
								this.app,
							).waitForConfirmation();
							if (!confirmed) {
								this.display();
								return;
							}
						}
						this.plugin.settings.includeAttachments = value;
						await this.plugin.saveSettings();
					}),
			);

		if (Platform.isAndroidApp) {
			new Setting(containerEl)
				.setName("Sync only on WiFi")
				.setDesc("Pause automatic syncing on cellular.")
				.addToggle((toggle) =>
					toggle
						.setValue(settings.wifiOnly)
						.onChange(async (value) => {
							this.plugin.settings.wifiOnly = value;
							await this.plugin.saveSettings();
						}),
				);
		}

		new Setting(containerEl)
			.setName("Force sync")
			.setDesc("Manually re-index the entire vault now.")
			.addButton((btn) =>
				btn.setButtonText("Update").onClick(async () => {
					btn.setDisabled(true);
					try {
						await this.plugin.engine.maybeReconcile(true);
						new Notice("Open Notebook: re-sync requested.");
					} catch (err) {
						this.handleApiError(err);
					} finally {
						btn.setDisabled(false);
					}
				}),
			);

		new Setting(containerEl)
			.addButton((btn) =>
				btn
					.setButtonText("View sync status")
					.setCta()
					.onClick(() => this.plugin.openStatusModal()),
			)
			.addButton((btn) =>
				btn.setButtonText("Open releases").onClick(() => {
					window.open(
						"https://github.com/Steve524/open-mod-notebook",
						"_blank",
					);
				}),
			);
	}

	hide(): void {
		this.plugin.offStatusChange(this.onStatusChange);
		this.connectionIndicator = null;
	}

	private renderConnectionHeading(containerEl: HTMLElement): void {
		const heading = new Setting(containerEl).setName("Connection").setHeading();
		heading.nameEl.addClass("notebook-sync-connection-heading");
		this.connectionIndicator = heading.nameEl.createSpan({
			cls: "notebook-sync-connection-indicator",
		});
		this.updateConnectionIndicator();
	}

	private updateConnectionIndicator(): void {
		const indicator = this.connectionIndicator;
		if (!indicator) return;
		const visual = STATUS_VISUALS[this.plugin.lastStatus.kind];
		indicator.empty();
		indicator.removeClass("notebook-sync-connection-indicator--err");
		if (visual.isError) {
			indicator.addClass("notebook-sync-connection-indicator--err");
		}
		setIcon(indicator, visual.icon);
		indicator.setAttr("aria-label", visual.label);
		indicator.setAttr("title", visual.label);
	}

	private async refreshSearchSpaces(): Promise<void> {
		this.loadingSpaces = true;
		try {
			this.searchSpaces = await this.plugin.api.listSearchSpaces();
		} catch (err) {
			this.handleApiError(err);
			this.searchSpaces = [];
		} finally {
			this.loadingSpaces = false;
		}
	}

	private renderFolderList(
		containerEl: HTMLElement,
		title: string,
		desc: string,
		current: string[],
		write: (next: string[]) => void,
	): void {
		const setting = new Setting(containerEl).setName(title).setDesc(desc);

		const persist = async (next: string[]): Promise<void> => {
			const dedup = Array.from(new Set(next.map(normalizeFolder)));
			write(dedup);
			await this.plugin.saveSettings();
			this.display();
		};

		setting.addButton((btn) =>
			btn
				.setButtonText("Add folder")
				.setCta()
				.onClick(() => {
					new FolderSuggestModal(
						this.app,
						(picked) => {
							void persist([...current, picked]);
						},
						current,
					).open();
				}),
		);

		for (const folder of current) {
			new Setting(containerEl).setName(folder || "/").addExtraButton((btn) =>
				btn
					.setIcon("cross")
					.setTooltip("Remove")
					.onClick(() => {
						void persist(current.filter((f) => f !== folder));
					}),
			);
		}
	}

	private handleApiError(err: unknown): void {
		if (err instanceof AuthError) {
			if (err.message.startsWith("Missing API token")) {
				new Notice("Open Notebook: paste an API token before verifying.");
			}
			return;
		}
		this.plugin.engine.reportError(err);
		new Notice(
			`Open Notebook: request failed — ${(err as Error).message ?? "unknown error"}`,
		);
	}
}
