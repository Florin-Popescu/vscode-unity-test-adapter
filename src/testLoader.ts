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
		this.unitUnderTestFolder = ConfigurationProvider.getPath('unitUnderTestFolder');
		this.unitUnderTestFileRegex = ConfigurationProvider.getString('unitUnderTestFileRegex');
		this.testSourceFolder = ConfigurationProvider.getPath('testSourceFolder');
		this.testSourceFileRegex = ConfigurationProvider.getString('testSourceFileRegex');
		this.testCaseRegex = ConfigurationProvider.getString('testCaseRegex');
		this.controller = controller;

		// When text documents are open, parse tests in them.
		vscode.workspace.onDidOpenTextDocument(document =>
			this.parseTestsInDocument(document));

		// When text documents are saved, reparse tests in them.
		vscode.workspace.onDidSaveTextDocument(document => {
			let docNodes: string[] = [];
			this.controller.items.forEach(item => {
				if(item.uri?.toString() === document.uri.toString()) {
					docNodes.push(item.id);
				}
			});
			docNodes.forEach(node => this.controller.items.delete(node));
			this.parseTestsInDocument(document);
		});

		// When configuration is changed, update the internal variables
		vscode.workspace.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration('unityExplorer')) {
				controller.invalidateTestResults();
			}

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

	private invalidateIfUnitUnderTest(uri: vscode.Uri) {
		if (uri.scheme === 'file') {
			var fileMatch = new RegExp(this.unitUnderTestFileRegex).test(uri.fsPath);
			var folderMatch = uri.fsPath.includes(this.unitUnderTestFolder);

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
			var fileMatch = new RegExp(this.testSourceFileRegex).test(uri.fsPath);
			var folderMatch = uri.fsPath.includes(this.testSourceFolder);

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
		var fileMatch = new RegExp(this.testSourceFileRegex).test(document.uri.fsPath);
		var folderMatch = document.uri.fsPath.includes(this.testSourceFolder);

		if (fileMatch && folderMatch) {
			this.parseTestsInFileContents(this.controller, this.getOrCreateTestFile(document.uri));
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

	private setFileLabel(uri: vscode.Uri): string {
		let fileLabel;

		let workspace = ConfigurationProvider.getWorkspace(uri);
		if (workspace) {
			fileLabel = path.relative(workspace.uri.fsPath, uri.fsPath);
		}
		else {
			fileLabel = uri.fsPath;
		}

		if (this.prettyTestFileRegex !== '') {
			const labelFileRegex = new RegExp(this.prettyTestFileRegex);
			let labelMatches = labelFileRegex.exec(fileLabel);
			if (labelMatches !== null) {
				fileLabel = labelMatches[1];
			}
		}

		return fileLabel;
	}
}
