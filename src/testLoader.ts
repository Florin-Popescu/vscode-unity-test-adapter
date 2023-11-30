import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ConfigurationProvider } from './configurationProvider';

export class TestLoader {
	constructor(private controller: vscode.TestController) {
		// When text documents are open, parse tests in them.
		vscode.workspace.onDidOpenTextDocument(document =>
			this.parseTestsInDocument(document));

		// When configuration is changed, update the internal variables
		vscode.workspace.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration('unityExplorer')) {
				controller.invalidateTestResults();
			}
			if (vscode.workspace.workspaceFolders) {
				vscode.workspace.workspaceFolders
					.filter(workspaceFolder => ConfigurationProvider.getBoolean('enable', workspaceFolder.uri, true))
					.forEach(workspaceFolder => {
						if (event.affectsConfiguration('unityExplorer', workspaceFolder)) { controller.invalidateTestResults(); }
					});
			}

			this.loadAllTests(controller);
		});
	}

	private invalidateIfUnitUnderTest(uri: vscode.Uri) {
		if (uri.scheme === 'file') {
			var fileMatch = new RegExp(ConfigurationProvider.getString('unitUnderTestFileRegex', uri)).test(uri.fsPath);
			var folderMatch = uri.fsPath.includes(ConfigurationProvider.getPath('unitUnderTestFolder', uri));

			if (fileMatch && folderMatch) {
				this.controller.items.forEach(test => {
					if (test.uri && path.parse(test.uri.fsPath).name.includes(path.parse(uri.fsPath).name)) {
						this.controller.invalidateTestResults(test);
					}
				});
			}
		}
	}

	private invalidateIfTestSource(uri: vscode.Uri) {
		let test = this.controller.items.get(uri.toString());
		if (test) {
			this.controller.invalidateTestResults(test);
		}
	}

	private getOrCreateTestFile(uri: vscode.Uri) {
		const existing = this.controller.items.get(uri.toString());
		if (existing) {
			return existing;
		}

		if (uri.scheme === 'file') {
			var fileMatch = new RegExp(ConfigurationProvider.getString('testSourceFileRegex', uri)).test(uri.fsPath);
			var folderMatch = uri.fsPath.includes(ConfigurationProvider.getString('testSourceFolder', uri));

			if (fileMatch && folderMatch) {
				const fileLabel = this.setFileLabel(uri);
				const testFile = this.controller.createTestItem(uri.toString(), fileLabel, uri);
				this.controller.items.add(testFile);
				testFile.canResolveChildren = true;

				return testFile;
			}
		}
	}

	private parseTestsInDocument(document: vscode.TextDocument) {
		var isEnabled = ConfigurationProvider.getBoolean('enable',document.uri, true);
		var fileMatch = new RegExp(ConfigurationProvider.getString('testSourceFileRegex', document.uri)).test(document.uri.fsPath);
		var folderMatch = document.uri.fsPath.includes(ConfigurationProvider.getPath('testSourceFolder', document.uri));

		if (isEnabled && fileMatch && folderMatch) {
			this.parseTestsInFileContents(this.controller, this.getOrCreateTestFile(document.uri));
		}
	}

	async parseTestsInFileContents(controller: vscode.TestController, file: vscode.TestItem | undefined): Promise<vscode.TestItem[]> {
		let testSuite = new Array<vscode.TestItem>;
		if (file !== undefined && file.uri !== undefined) {
			file.busy = true;
			const testRegex = new RegExp(ConfigurationProvider.getString('testCaseRegex', file.uri), 'gm');
			const fileText = await fs.promises.readFile(file.uri?.fsPath, 'utf8');

			let match = testRegex.exec(fileText);

			while (match !== null) {
				let testName = match[1];
				const testLabel = this.setTestLabel(testName, file.uri);
				let line = fileText.substring(0, match.index).split('\n').length - 1;
				let testUri = file.uri;

				line = line + match[0].substring(0, match[0].search(/\S/g)).split('\n').length - 1;

				let testItem = controller.createTestItem(testName, testLabel, testUri);
				testItem.range = new vscode.Range(new vscode.Position(line, 0), new vscode.Position(line, match[0].length));

				file.children.add(testItem);
				match = testRegex.exec(fileText);
			}
			file.busy = false;
		}

		return testSuite;
	}

	async loadAllTests(controller: vscode.TestController) {
		let isEnabled = ConfigurationProvider.getBoolean('enable', undefined, true);

		if (!vscode.workspace.workspaceFolders || !isEnabled) {
			return []; // handle the case of no open folders
		}

		return Promise.all(
			vscode.workspace.workspaceFolders
				.filter(workspaceFolder => ConfigurationProvider.getBoolean('enable', workspaceFolder.uri, true))
				.map(async workspaceFolder => {
					const pattern = new vscode.RelativePattern(workspaceFolder, '**/*.c');
					const watcher = vscode.workspace.createFileSystemWatcher(pattern);

					// When files are created, make sure there's a corresponding "file" node in the tree
					watcher.onDidCreate(uri => this.getOrCreateTestFile(uri));
					// When files change, re-parse them. Note that you could optimize this so
					// that you only re-parse children that have been resolved in the past.
					watcher.onDidChange(uri => {
						this.parseTestsInFileContents(this.controller, this.getOrCreateTestFile(uri));
						this.invalidateIfUnitUnderTest(uri);
						this.invalidateIfTestSource(uri);
					});
					// And, finally, delete TestItems for removed files. This is simple, since
					// we use the URI as the TestItem's ID.
					watcher.onDidDelete(uri => controller.items.delete(uri.toString()));

					for (const file of await vscode.workspace.findFiles(pattern)) {
						this.getOrCreateTestFile(file);
					}

					return watcher;
				})
		);
	}

	private setTestLabel(testName: string, uri: vscode.Uri): string {
		let testLabel = testName;
		let prettyTestCaseRegex = ConfigurationProvider.getString('testSourceFileRegex', uri);

		if (prettyTestCaseRegex !== '') {
			const labeltestLabelRegex = new RegExp(prettyTestCaseRegex);
			let testLabelMatches = labeltestLabelRegex.exec(testName);

			if (testLabelMatches !== null) {
				testLabel = testLabelMatches[1];
			}
		}
		return testLabel;
	}

	private setFileLabel(uri: vscode.Uri): string {
		let workspace = ConfigurationProvider.getWorkspace(uri);
		let fileLabel = workspace ? path.relative(workspace.uri.fsPath, uri.fsPath) : uri.fsPath;
		let prettyTestFileRegex = ConfigurationProvider.getString('prettyTestFileRegex', uri);

		if (prettyTestFileRegex !== '') {
			const labelFileRegex = new RegExp(prettyTestFileRegex);
			let labelMatches = labelFileRegex.exec(fileLabel);
			if (labelMatches !== null) {
				fileLabel = labelMatches[1];
			}
		}

		return fileLabel;
	}
}
