import * as vscode from 'vscode';
import * as Path from 'path';
import * as fs from 'fs';
import { TestHub, testExplorerExtensionId } from 'vscode-test-adapter-api';
import { TestAdapterRegistrar } from 'vscode-test-adapter-util';
import { UnityAdapter } from './adapter';

let unityAdapter: UnityAdapter;

function getCurrentDebugConfiguration(): string {
	const currentExec = unityAdapter.getDebugTestExecutable();
	if (!currentExec) {
		vscode.window.showErrorMessage("Not currently debugging a Unity Test");
		return "";
	}
	return currentExec;
}

export async function activate(context: vscode.ExtensionContext) {
	var manifestPath = Path.join(context.extensionPath, "package.json");
	var packageFile = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

	if (packageFile) {
		var outputChannel = vscode.window.createOutputChannel(packageFile.displayName);
	}

	const testExplorerExtension = vscode.extensions.getExtension<TestHub>(testExplorerExtensionId);
	if (testExplorerExtension) {
		context.subscriptions.push(vscode.commands.registerCommand("unityExplorer.debugTestExecutable", getCurrentDebugConfiguration));
		context.subscriptions.push(new TestAdapterRegistrar(
			testExplorerExtension.exports,
			workspaceFolder => {
				unityAdapter = new UnityAdapter(workspaceFolder, outputChannel);

				return unityAdapter;
			}));
	}
}
