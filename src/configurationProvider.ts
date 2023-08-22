import * as path from 'path';
import * as vscode from 'vscode';

export class ConfigurationProvider {
	static getWorkspace(uri: vscode.Uri): vscode.WorkspaceFolder | undefined {
		if (vscode.workspace.workspaceFolders) {
			for (const workspaceFolder of vscode.workspace.workspaceFolders) {
				if (uri.toString().includes(workspaceFolder.uri.toString())) {
					return workspaceFolder;
				}
			}
			return vscode.workspace.workspaceFolders[0];
		}
	}

	static getWorkspaceConfiguration(): vscode.WorkspaceConfiguration | undefined {
		if (vscode.workspace.workspaceFolders) {
			return vscode.workspace.getConfiguration('unityExplorer');
		}
	}

	static getString(name: string): string {
		let configuration = this.getWorkspaceConfiguration();
		if (configuration) {
			return configuration.get<string>(name, '');
		}
		else {
			return '';
		}
	}

	static getPath(name: string): string {
		let workspace = vscode.workspace.workspaceFolders;

		if (workspace !== undefined) {
			const result = this.getString(name);
			let workspacePath = workspace[0].uri.fsPath;
			return path.resolve(workspacePath, result);
		}
		else {
			return '';
		}
	}
}
