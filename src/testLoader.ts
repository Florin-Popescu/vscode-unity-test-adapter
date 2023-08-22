import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ConfigurationProvider } from './configurationProvider';

export class TestLoader {
	prettyTestCaseRegex: string;
	prettyTestFileRegex: string;
	unitUnderTestFolder: string;
	unitUnderTestFileRegex: string;
	testSourceFolder: string;
	testSourceFileRegex: string;
	testCaseRegex: string;

	constructor(private controller: vscode.TestController) {
		this.prettyTestCaseRegex = ConfigurationProvider.getString('prettyTestCaseRegex');
		this.prettyTestFileRegex = ConfigurationProvider.getString('prettyTestFileRegex');
		this.unitUnderTestFolder = ConfigurationProvider.getString('unitUnderTestFolder');
		this.unitUnderTestFileRegex = ConfigurationProvider.getString('unitUnderTestFileRegex');
		this.testSourceFolder = ConfigurationProvider.getString('testSourceFolder');
		this.testSourceFileRegex = ConfigurationProvider.getString('testSourceFileRegex');
		this.testCaseRegex = ConfigurationProvider.getString('testCaseRegex');

		// When text documents are open, parse tests in them.
		vscode.workspace.onDidOpenTextDocument(document =>
			this.parseTestsInDocument(document));

		// When configuration is changed, update the internal variables
		vscode.workspace.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration('unityExplorer.prettyTestCaseRegex')) {
				this.prettyTestCaseRegex = ConfigurationProvider.getString('prettyTestCaseRegex');
			}
			if (event.affectsConfiguration('unityExplorer.prettyTestFileRegex')) {
				this.prettyTestFileRegex = ConfigurationProvider.getString('prettyTestFileRegex');
			}
			if (event.affectsConfiguration('unityExplorer.unitUnderTestFolder')) {
				this.unitUnderTestFolder = ConfigurationProvider.getPath('unitUnderTestFolder');
			}
			if (event.affectsConfiguration('unityExplorer.unitUnderTestFileRegex')) {
				this.unitUnderTestFileRegex = ConfigurationProvider.getString('unitUnderTestFileRegex');
			}
			if (event.affectsConfiguration('unityExplorer.testSourceFolder')) {
				this.testSourceFolder = ConfigurationProvider.getPath('testSourceFolder');
			}
			if (event.affectsConfiguration('unityExplorer.testSourceFileRegex')) {
				this.testSourceFileRegex = ConfigurationProvider.getString('testSourceFileRegex');
			}
			if (event.affectsConfiguration('unityExplorer.testCaseRegex')) {
				this.testCaseRegex = ConfigurationProvider.getString('testCaseRegex');
			}

			this.loadAllTests(controller);
		});
	}

	private getOrCreateFile(uri: vscode.Uri) {
		const existing = this.controller.items.get(uri.toString());
		if (existing) {
			return existing;
		}

		if (vscode.workspace.workspaceFolders) {
			for (const workspaceFolder of vscode.workspace.workspaceFolders) {
				if (uri.toString().includes(workspaceFolder.uri.toString())) {
					var fileMatch = new RegExp(this.testSourceFileRegex).test(uri.fsPath);
					var relativePath = path.relative(workspaceFolder.uri.fsPath, uri.fsPath);
					var folderMatch = relativePath.includes(this.testSourceFolder);

					if (fileMatch && folderMatch) {
						const fileLabel = this.setFileLabel(uri.fsPath);
						const testFile = this.controller.createTestItem(uri.toString(), fileLabel, uri);
						this.controller.items.add(testFile);
						testFile.canResolveChildren = true;

						return testFile;
					}
				}
			}
		}
	}

	private parseTestsInDocument(document: vscode.TextDocument) {
		if (vscode.workspace.workspaceFolders) {
			for (const workspaceFolder of vscode.workspace.workspaceFolders) {
				if (document.uri.toString().includes(workspaceFolder.uri.toString())) {
					var fileMatch = new RegExp(this.testSourceFileRegex).test(document.uri.fsPath);
					var relativePath = path.relative(workspaceFolder.uri.fsPath, document.uri.fsPath);
					var folderMatch = relativePath.includes(this.testSourceFolder);

					if (fileMatch && folderMatch) {
						this.parseTestsInFileContents(this.controller, this.getOrCreateFile(document.uri));
					}
				}
			}
		}
	}

	async parseTestsInFileContents(controller: vscode.TestController, file: vscode.TestItem | undefined): Promise<vscode.TestItem[]> {
		let testSuite = new Array<vscode.TestItem>;

		if (file !== undefined && file.uri !== undefined) {
			file.busy = true;
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
				testItem.range = new vscode.Range(new vscode.Position(line, 0), new vscode.Position(line, match[0].length));

				file.children.add(testItem);
				match = testRegex.exec(fileText);
			}
			file.busy = false;
		}

		return testSuite;
	}

	async loadAllTests(controller: vscode.TestController) {
		if (!vscode.workspace.workspaceFolders) {
			return []; // handle the case of no open folders
		}

		return Promise.all(
			vscode.workspace.workspaceFolders.map(async workspaceFolder => {
				const pattern = new vscode.RelativePattern(workspaceFolder, '**/*.c');
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
					this.getOrCreateFile(file);
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

		if (vscode.workspace.workspaceFolders !== undefined) {
			fileLabel = path.relative(vscode.workspace.workspaceFolders[0].uri.fsPath, fileName);
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
