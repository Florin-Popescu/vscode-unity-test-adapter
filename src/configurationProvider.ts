import * as path from 'path';
import * as vscode from 'vscode';

export class ConfigurationProvider {
	static getWorkspaceConfiguration(): vscode.WorkspaceConfiguration | undefined {
		if (vscode.workspace.workspaceFolders !== undefined) {
			return vscode.workspace.getConfiguration('unityExplorer', vscode.workspace.workspaceFolders[0].uri);
		}
	}

	static getString(name: string): string {
		let configuration = this.getWorkspaceConfiguration();
		if (configuration !== undefined) {
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
