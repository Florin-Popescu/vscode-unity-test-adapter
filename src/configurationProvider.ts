import * as path from 'path';
import * as vscode from 'vscode';

export class ConfigurationProvider {
	static getWorkspace(uri: vscode.Uri): vscode.WorkspaceFolder | undefined {
		return vscode.workspace.workspaceFolders
			? vscode.workspace.getWorkspaceFolder (uri) ?? vscode.workspace.workspaceFolders[0] 
			: undefined;
	}

	static getWorkspaceConfiguration(uri: vscode.Uri | undefined = undefined): vscode.WorkspaceConfiguration | undefined {
		if (vscode.workspace.workspaceFolders) {
			let itemUri = uri ?? vscode.window.activeTextEditor?.document.uri;
			if (itemUri) {
				let workspaceFolder = vscode.workspace.getWorkspaceFolder (itemUri);
				if (workspaceFolder) {
					return vscode.workspace.getConfiguration('unityExplorer', workspaceFolder);
				}
			}
		}
		return vscode.workspace.getConfiguration('unityExplorer');
	}

	static resolveConfiguration<T>(name: string, uri: vscode.Uri | undefined = undefined, defaultValue: T): T | undefined {
		let configuration = this.getWorkspaceConfiguration(uri);
		if (configuration) {
			let values = configuration.inspect<T>(name);
			if (values) {
				if (values.workspaceFolderLanguageValue) { return values.workspaceFolderLanguageValue; }
				if (values.workspaceFolderValue) { return values.workspaceFolderValue; }
				if (values.workspaceLanguageValue) { return values.workspaceLanguageValue; }
				if (values.workspaceValue) { return values.workspaceValue; }
				if (values.globalLanguageValue) { return values.globalLanguageValue; }
				if (values.defaultLanguageValue) { return values.defaultLanguageValue; }
				if (values.globalValue) { return values.globalValue; }
				if (values.defaultValue) { return values.defaultValue; }
			}
		}

		return defaultValue;
	}

	static getString(name: string, uri: vscode.Uri | undefined = undefined, defaultValue: string = ''): string {
		let configuration = this.getWorkspaceConfiguration(uri);
		if (configuration) {
			return this.resolveConfiguration<string>(name, uri, defaultValue) ?? defaultValue;
		}
		
		return defaultValue;
	}

	static getBoolean(name: string, uri: vscode.Uri | undefined = undefined, defaultValue: boolean = false): boolean {
		let configuration = this.getWorkspaceConfiguration(uri);
		if (configuration) {
			return this.resolveConfiguration<boolean>(name, uri, defaultValue) ?? defaultValue;
		}

		return defaultValue;
	}

	static getPath(name: string, uri: vscode.Uri | undefined = undefined): string {
		const result = this.getString(name);
		if (vscode.window.activeTextEditor) {
			let workspaceFolder = vscode.workspace.getWorkspaceFolder (vscode.window.activeTextEditor.document.uri);
			if (workspaceFolder) {
				return path.resolve(workspaceFolder.uri.fsPath, result);
			}
		}
		if (uri) {
			let workspaceFolder = this.getWorkspace(uri);
			if (workspaceFolder) {
				return path.resolve(workspaceFolder.uri.fsPath, result);
			}
		}

		return '';
	}
}
