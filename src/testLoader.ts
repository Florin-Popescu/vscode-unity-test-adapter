import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ConfigurationProvider } from './configurationProvider';

export class TestLoader {
	private workspace: readonly vscode.WorkspaceFolder[] | undefined;
	prettyTestCaseRegex: string;
	prettyTestFileRegex: string;
	testSourceGlobPattern: string;
	testCaseRegex: string;

	constructor(private controller: vscode.TestController) {
		this.workspace = vscode.workspace.workspaceFolders;

		this.prettyTestCaseRegex = ConfigurationProvider.getString('prettyTestCaseRegex');
		this.prettyTestFileRegex = ConfigurationProvider.getString('prettyTestFileRegex');
		this.testSourceGlobPattern = ConfigurationProvider.getString('testSourceGlobPattern');
		this.testCaseRegex = ConfigurationProvider.getString('testCaseRegex');

		// When text documents are open, parse tests in them.
		vscode.workspace.onDidOpenTextDocument(document =>
			this.parseTestsInDocument(document));

		// When configuration is changed, update the internal variables
		vscode.workspace.onDidChangeConfiguration(event => {
			if (vscode.workspace.workspaceFolders !== undefined) {
				if (event.affectsConfiguration('unityExplorer.prettyTestCaseRegex')) {
					this.prettyTestCaseRegex = ConfigurationProvider.getString('prettyTestCaseRegex');
				}
				if (event.affectsConfiguration('unityExplorer.prettyTestFileRegex')) {
					this.prettyTestFileRegex = ConfigurationProvider.getString('prettyTestFileRegex');
				}
				if (event.affectsConfiguration('unityExplorer.testSourceGlobPattern')) {
					this.testSourceGlobPattern = ConfigurationProvider.getString('testSourceGlobPattern');
				}
				if (event.affectsConfiguration('unityExplorer.testCaseRegex')) {
					this.testCaseRegex = ConfigurationProvider.getString('testCaseRegex');
				}
			}

			this.loadAllTests(controller);
		});
	}

	// In this function, we'll get the file TestItem if we've already found it,
	// otherwise we'll create it with `canResolveChildren = true` to indicate it
	// can be passed to the `controller.resolveHandler` to gets its children.
	private getOrCreateFile(uri: vscode.Uri) {
		const existing = this.controller.items.get(uri.toString());
		if (existing) {
			return existing;
		}

		const fileLabel = this.setFileLabel(uri.fsPath);
		const testFile = this.controller.createTestItem(uri.toString(), fileLabel, uri);
		this.controller.items.add(testFile);
		testFile.canResolveChildren = true;

		return testFile;
	}

	private parseTestsInDocument(document: vscode.TextDocument) {
		if (this.workspace) {
			for (const workspaceFolder of this.workspace) {
				if (document.uri.toString().includes(workspaceFolder.uri.toString())) {
					var globToRegExp = require('glob-to-regexp');
					var relativePath = path.relative(workspaceFolder.uri.fsPath, document.uri.fsPath);

					if (document.uri.scheme === 'file' && globToRegExp(this.testSourceGlobPattern).test(relativePath)) {
						this.parseTestsInFileContents(this.controller, this.getOrCreateFile(document.uri));
					}
				}
			}
		}
	}

	async parseTestsInFileContents(controller: vscode.TestController, file: vscode.TestItem): Promise<vscode.TestItem[]> {
		let testSuite = new Array<vscode.TestItem>;

		if (file.uri !== undefined) {
			const fileLabel = this.setFileLabel(file.uri?.fsPath);
			const testRegex = new RegExp(this.testCaseRegex, 'gm');
			const fileText = await fs.promises.readFile(file.uri?.fsPath, 'utf8');

			let match = testRegex.exec(fileText);

			while (match !== null) {
				let testName = match[1];
				const testLabel = this.setTestLabel(testName);
				let line = fileText.substr(0, match.index).split('\n').length - 1;
				let testUri = file.uri;

				line = line + match[0].substr(0, match[0].search(/\S/g)).split('\n').length - 1;

				let testItem = controller.createTestItem(testName, testLabel, testUri);

				file.children.add(testItem);
				match = testRegex.exec(fileText);
			}
		}

		return testSuite;
	}

	async loadAllTests(controller: vscode.TestController) {
		if (!this.workspace) {
			return []; // handle the case of no open folders
		}

		return Promise.all(
			this.workspace.map(async workspaceFolder => {
				const pattern = new vscode.RelativePattern(workspaceFolder, this.testSourceGlobPattern);
				const watcher = vscode.workspace.createFileSystemWatcher(pattern);

				// When files are created, make sure there's a corresponding "file" node in the tree
				watcher.onDidCreate(uri => this.getOrCreateFile(uri));
				// When files change, re-parse them. Note that you could optimize this so
				// that you only re-parse children that have been resolved in the past.
				watcher.onDidChange(uri => this.parseTestsInFileContents(this.controller, this.getOrCreateFile(uri)));
				// And, finally, delete TestItems for removed files. This is simple, since
				// we use the URI as the TestItem's ID.
				watcher.onDidDelete(uri => controller.items.delete(uri.toString()));

				for (const file of await vscode.workspace.findFiles(pattern)) {
					this.parseTestsInFileContents(this.controller, this.getOrCreateFile(file));
				}

				return watcher;
			})
		);
	}

	private setTestLabel(testName: string): string {
		let testLabel = testName;

		if (this.prettyTestCaseRegex !== '') {
			const labeltestLabelRegex = new RegExp(this.prettyTestCaseRegex);
			let testLabelMatches = labeltestLabelRegex.exec(testName);

			if (testLabelMatches !== null) {
				testLabel = testLabelMatches[1];
			}
		}
		return testLabel;
	}

	private setFileLabel(fileName: string): string {
		let fileLabel;

		if (this.workspace !== undefined) {
			fileLabel = path.relative(this.workspace[0].uri.fsPath, fileName);
		}
		else {
			fileLabel = fileName;
		}

		if (this.prettyTestFileRegex !== '') {
			const labelFileRegex = new RegExp(this.prettyTestFileRegex);
			let labelMatches = labelFileRegex.exec(fileName);
			if (labelMatches !== null) {
				fileLabel = labelMatches[1];
			}
		}

		return fileLabel;
	}
}
