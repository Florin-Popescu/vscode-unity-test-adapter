import * as child_process from 'child_process';
import * as async_mutex from 'async-mutex';
import * as tree_kill from 'tree-kill';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
	TestAdapter,
	TestLoadStartedEvent,
	TestLoadFinishedEvent,
	TestRunStartedEvent,
	TestRunFinishedEvent,
	TestSuiteEvent,
	TestEvent,
	TestSuiteInfo,
	TestInfo
} from 'vscode-test-adapter-api';

export class UnityAdapter implements TestAdapter {
	private disposables: { dispose(): void }[] = [];

	private readonly testsEmitter = new vscode.EventEmitter<TestLoadStartedEvent | TestLoadFinishedEvent>();
	private readonly testStatesEmitter = new vscode.EventEmitter<TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent>();
	private readonly autorunEmitter = new vscode.EventEmitter<void>();

	private watchedFileForAutorunList: string[] = [];
	private watchedFileForReloadList: string[] = [];
	private testSuiteInfo: TestSuiteInfo = {
		type: 'suite',
		id: 'root',
		label: 'Unity',
		children: []
	};
	private prettyTestCaseRegex: string = '.*';
	private prettyTestFileRegex: string = '.*';
	private unitUnderTestFolder: string = '.';
	private unitUnderTestFileRegex: string = '\\.[hc]';
	private testSourceFolder: string = '.';
	private testSourceFileRegex: string = '';
	private testCaseRegex: string = '';
	private preBuildCommand: string = '';
	private testBuildApplication: string = 'make';
	private testBuildCwdPath: string = '.';
	private testBuildArgs: string = '';
	private testBuildTargetRegex: string = '$1';
	private testExecutableRegex: string = '$1';
	private testExecutableArgs: string = '';
	private testExecutableArgSingleCaseRegex: string = '';

	private readonly testFailLineNrRegex = ':([0-9]+):';
	private readonly testResultString = '(PASS|FAIL:\ ?(.*))';
	private buildProcess: child_process.ChildProcess | undefined;
	private suiteProcess: child_process.ChildProcess | undefined;
	private buildMutex: async_mutex.Mutex = new async_mutex.Mutex();
	private suiteMutex: async_mutex.Mutex = new async_mutex.Mutex();

	get tests(): vscode.Event<TestLoadStartedEvent | TestLoadFinishedEvent> { return this.testsEmitter.event; }
	get testStates(): vscode.Event<TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent> { return this.testStatesEmitter.event; }
	get autorun(): vscode.Event<void> | undefined { return this.autorunEmitter.event; }

	constructor(
		public readonly workspace: vscode.WorkspaceFolder,
		public readonly outputChannel: vscode.OutputChannel
	) {
		this.disposables.push(this.testsEmitter);
		this.disposables.push(this.testStatesEmitter);
		this.disposables.push(this.autorunEmitter);

		this.prettyTestCaseRegex = this.getConfigurationString('prettyTestCaseRegex');
		this.prettyTestFileRegex = this.getConfigurationString('prettyTestFileRegex');
		this.unitUnderTestFolder = this.getConfigurationPath('unitUnderTestFolder');
		this.unitUnderTestFileRegex = this.getConfigurationString('unitUnderTestFileRegex');
		this.testSourceFolder = this.getConfigurationPath('testSourceFolder');
		this.testSourceFileRegex = this.getConfigurationString('testSourceFileRegex');
		this.testCaseRegex = this.getConfigurationString('testCaseRegex');
		this.preBuildCommand = this.getConfigurationString('preBuildCommand');
		this.testBuildApplication = this.getConfigurationString('testBuildApplication');
		this.testBuildCwdPath = this.getConfigurationPath('testBuildCwdPath');
		this.testBuildArgs = this.getConfigurationString('testBuildArgs');
		this.testBuildTargetRegex = this.getConfigurationString('testBuildTargetRegex');
		this.testExecutableRegex = this.getConfigurationString('testExecutableRegex');
		this.testExecutableArgs = this.getConfigurationString('testExecutableArgs');
		this.testExecutableArgSingleCaseRegex = this.getConfigurationString('testExecutableArgSingleCaseRegex');

		// callback when a config property is modified
		vscode.workspace.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration('unityExplorer.prettyTestCaseRegex')) {
				this.prettyTestCaseRegex = this.getConfigurationString('prettyTestCaseRegex');
			}
			if (event.affectsConfiguration('unityExplorer.prettyTestFileRegex')) {
				this.prettyTestFileRegex = this.getConfigurationString('prettyTestFileRegex');
			}
			if (event.affectsConfiguration('unityExplorer.unitUnderTestFolder')) {
				this.unitUnderTestFolder = this.getConfigurationPath('unitUnderTestFolder');
			}
			if (event.affectsConfiguration('unityExplorer.unitUnderTestFileRegex')) {
				this.unitUnderTestFileRegex = this.getConfigurationString('unitUnderTestFileRegex');
			}
			if (event.affectsConfiguration('unityExplorer.testSourceFolder')) {
				this.testSourceFolder = this.getConfigurationPath('testSourceFolder');
			}
			if (event.affectsConfiguration('unityExplorer.testSourceFileRegex')) {
				this.testSourceFileRegex = this.getConfigurationString('testSourceFileRegex');
			}
			if (event.affectsConfiguration('unityExplorer.testCaseRegex')) {
				this.testCaseRegex = this.getConfigurationString('testCaseRegex');
			}
			if (event.affectsConfiguration('unityExplorer.preBuildCommand')) {
				this.preBuildCommand = this.getConfigurationString('preBuildCommand');
			}
			if (event.affectsConfiguration('unityExplorer.testBuildApplication')) {
				this.testBuildApplication = this.getConfigurationString('testBuildApplication');
			}
			if (event.affectsConfiguration('unityExplorer.testBuildCwdPath')) {
				this.testBuildCwdPath = this.getConfigurationPath('testBuildCwdPath');
			}
			if (event.affectsConfiguration('unityExplorer.testBuildArgs')) {
				this.testBuildArgs = this.getConfigurationString('testBuildArgs');
			}
			if (event.affectsConfiguration('unityExplorer.testBuildTargetRegex')) {
				this.testBuildTargetRegex = this.getConfigurationString('testBuildTargetRegex');
			}
			if (event.affectsConfiguration('unityExplorer.testExecutableRegex')) {
				this.testExecutableRegex = this.getConfigurationString('testExecutableRegex');
			}
			if (event.affectsConfiguration('unityExplorer.testExecutableArgs')) {
				this.testExecutableArgs = this.getConfigurationString('testExecutableArgs');
			}
			if (event.affectsConfiguration('unityExplorer.testExecutableArgSingleCaseRegex')) {
				this.testExecutableArgSingleCaseRegex = this.getConfigurationString('testExecutableArgSingleCaseRegex');
			}
			this.load();
		})
	}

	async load(): Promise<void> {
		this.testsEmitter.fire(<TestLoadStartedEvent>{ type: 'started' });

		const sourceFiles = await this.getFileList(this.unitUnderTestFolder, new RegExp(this.unitUnderTestFileRegex));
		const testFiles = await this.getFileList(this.testSourceFolder, new RegExp(this.testSourceFileRegex));

		for (const file of testFiles) {
			if (sourceFiles.indexOf(file) != 0) {
				sourceFiles.splice(sourceFiles.indexOf(file), 1);
			}
		}

		this.watchFilesForAutorun(sourceFiles);
		this.watchFilesForAutorun(testFiles);

		this.watchFilesForReload(testFiles);

		this.testSuiteInfo = await this.loadTests(testFiles);

		this.testsEmitter.fire(<TestLoadFinishedEvent>{ type: 'finished', suite: this.testSuiteInfo });
	}

	async run(tests: string[]): Promise<void> {
		this.testStatesEmitter.fire(<TestRunStartedEvent>{ type: 'started', tests });

		this.outputChannel.clear();
		this.outputChannel.show();

		if (this.preBuildCommand != '') {
			let result = await this.runCommand(this.preBuildCommand);
			if (result.error) {
				vscode.window.showErrorMessage('Cannot run pre-build command.');
				return;
			}
		}

		if (tests[0] === 'root') {
			for (const suite of this.testSuiteInfo.children) {
				if (suite.type === 'suite') {
					await this.runSuites([suite.id], this.testStatesEmitter);
				}
			}
		}
		else {
			await this.runSuites(tests, this.testStatesEmitter);
		}

		this.testStatesEmitter.fire(<TestRunFinishedEvent>{ type: 'finished' });
	}

	async loadTests(files: string[]): Promise<TestSuiteInfo> {
		let localTestSuiteInfo = {
			type: 'suite',
			id: 'root',
			label: 'Unity',
			children: []
		} as TestSuiteInfo;

		for (const file of files) {
			const fileLabel = this.setFileLabel(file);
			const currentTestSuiteInfo: TestSuiteInfo = {
				type: 'suite',
				id: file,
				label: fileLabel,
				file: file,
				children: []
			};
			const testRegex = new RegExp(this.testCaseRegex, 'gm');
			const fileText = await fs.promises.readFile(file, 'utf8');
			let match = testRegex.exec(fileText);
			while (match != null) {
				let testName = match[1];
				const testLabel = this.setTestLabel(testName);
				let line = fileText.substr(0, match.index).split('\n').length - 1;
				line = line + match[0].substr(0, match[0].search(/\S/g)).split('\n').length - 1;
				currentTestSuiteInfo.children.push({
					type: 'test',
					id: file + '::' + testName,
					label: testLabel,
					file: file,
					line: line
				} as TestInfo)
				match = testRegex.exec(fileText);
			}
			localTestSuiteInfo.children.push(currentTestSuiteInfo);
		}

		return localTestSuiteInfo;
	}

	async runSuites(
		tests: string[],
		testStatesEmitter: vscode.EventEmitter<TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent>
	): Promise<void> {
		for (const suiteOrTestId of tests) {
			//Find containing suite
			const suite = this.findSuite(this.testSuiteInfo, suiteOrTestId);
			if (suite !== undefined && suite.type === 'suite') {
				let result = await this.runSuiteExe(suite, testStatesEmitter);

				if (suiteOrTestId == suite.id) {
					if (result.error && !result.stdout) {
						for (const child of suite.children) {
							testStatesEmitter.fire(<TestEvent>{ type: 'test', test: child.id, state: 'failed' });
						}
						if (result.stderr.search('The process cannot access the file because it is being used by another process')) {
							vscode.window.showErrorMessage('Cannot run test executable for ' + suiteOrTestId + '.');
						}
					} else {
						for (const child of suite.children) {
							if (child.type === 'test') {
								await this.checkTestResult(child, result.stdout, testStatesEmitter);
							}
						}
					}
				} else {
					if (result.error && !result.stdout) {
						for (const child of suite.children) {
							testStatesEmitter.fire(<TestEvent>{ type: 'test', test: child.id, state: 'failed' });
						}
						vscode.window.showErrorMessage('Cannot run test executable for ' + suiteOrTestId + '.');
					} else {
						const node = this.findNode(this.testSuiteInfo, suiteOrTestId);
						if (node !== undefined && node.type === 'test') {
							await this.checkTestResult(node, result.stdout, testStatesEmitter);
						}
					}
				}
			}
		}
	}

	findSuite(searchNode: TestSuiteInfo, id: string): TestSuiteInfo | undefined {
		if (searchNode.type === 'suite') {
			for (const child of searchNode.children) {
				if (child.id === id) {
					if (child.type === 'suite') return child;
					else return searchNode;
				} else if (child.type === 'suite') {
					const found = this.findSuite(child, id);
					if (found) return found;
				}
			}
		}
		return undefined;
	}

	findNode(searchNode: TestSuiteInfo | TestInfo, id: string): TestSuiteInfo | TestInfo | undefined {
		if (searchNode.id === id) {
			return searchNode;
		} else if (searchNode.type === 'suite') {
			for (const child of searchNode.children) {
				const found = this.findNode(child, id);
				if (found) return found;
			}
		}
		return undefined;
	}

	async runSuiteExe(
		node: TestSuiteInfo,
		testStatesEmitter: vscode.EventEmitter<TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent>
	): Promise<any> {
		testStatesEmitter.fire(<TestSuiteEvent>{ type: 'suite', suite: node.id, state: 'running' });

		let result = await this.buildTest(node);
		this.outputChannel.append(result.stdout);
		this.outputChannel.append(result.stderr);
		if (result.error) {
			vscode.window.showErrorMessage('Cannot build test executable.');
		} else {
			result = await this.runTest(node);
			this.outputChannel.append(result.stdout);
			this.outputChannel.append(result.stderr);
		}

		testStatesEmitter.fire(<TestSuiteEvent>{ type: 'suite', suite: node.id, state: 'completed' });

		return result;
	}

	async checkTestResult(
		node: TestInfo,
		suiteResult: string,
		testStatesEmitter: vscode.EventEmitter<TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent>
	): Promise<void> {
		testStatesEmitter.fire(<TestEvent>{ type: 'test', test: node.id, state: 'running' });

		let testCaseRegex = new RegExp(node.label + '.*' + this.testResultString);
		let match = testCaseRegex.exec(suiteResult);

		if (match != null) {
			if (match[1] === 'PASS') {
				testStatesEmitter.fire(<TestEvent>{
					type: 'test',
					test: node.id,
					state: 'passed'
				});
			} else {
				let testFailRegex = new RegExp(this.testFailLineNrRegex + '.*' + node.label + '.*' + this.testResultString);
				match = testFailRegex.exec(suiteResult);

				if (match != null) {
					//Regular Unity format
					testStatesEmitter.fire(<TestEvent>{
						type: 'test',
						test: node.id,
						state: 'failed',
						decorations: [{
							line: parseInt(match[1]) - 1,
							message: match[3]
						}]
					});
				}
				else {
					testFailRegex = new RegExp(node.label + '.*' + this.testFailLineNrRegex + '.*' + this.testResultString);
					match = testFailRegex.exec(suiteResult);

					if (match != null) {
						//Unity Fixture format
						testStatesEmitter.fire(<TestEvent>{
							type: 'test',
							test: node.id,
							state: 'failed',
							decorations: [{
								line: parseInt(match[1]) - 1,
								message: match[3]
							}]
						});
					}
				}
			}
		}
	}

	private async runBuildCommand(buildArgs: string): Promise<any> {
		const release = await this.buildMutex.acquire();
		try {
			return new Promise<any>((resolve) => {
				this.buildProcess = child_process.exec(
					this.testBuildApplication + ' ' + buildArgs,
					{
						cwd: this.testBuildCwdPath
					},
					(error, stdout, stderr) => {
						resolve({ error, stdout, stderr });
					},
				)
			});
		} finally {
			release();
		}
	}

	private async runCommand(command: string): Promise<any> {
		const release = await this.suiteMutex.acquire();
		try {
			return new Promise<any>((resolve) => {
				this.suiteProcess = child_process.exec(
					command,
					{
						cwd: this.workspace.uri.fsPath,
					},
					(error, stdout, stderr) => {
						resolve({ error, stdout, stderr });
					},
				)
			});
		} catch {

		}
		finally {
			release();
		}
	}

	async buildTest(node: TestSuiteInfo): Promise<any> {
		let buildArgs = this.testBuildArgs;

		if (node.file != undefined) {
			let target = path.parse(node.file).name.replace(new RegExp('(.*)'), this.testBuildTargetRegex);
			target = target.replace(/\\/g, '/');

			return await this.runBuildCommand(buildArgs + ' ' + target);
		}
	}

	async runTest(node: TestSuiteInfo): Promise<any> {
		if (node.file != undefined) {
			let exePath = '\"' + path.parse(node.file).name.replace(new RegExp('(.*)'), this.testExecutableRegex) + '\"';

			return await this.runCommand(exePath + ' ' + this.testExecutableArgs);
		}
	}

	async debug(tests: string[]): Promise<void> {
		try {
			//Get and validate debug configuration
			const debugConfiguration = this.getConfiguration().get<string>('debugConfiguration', '');
			if (!debugConfiguration) {
				vscode.window.showErrorMessage("No debug configuration specified. In Settings, set unityExplorer.debugConfiguration.");
				return;
			}

			//Run pre-build command
			if (this.preBuildCommand != '') {
				let result = await this.runCommand(this.preBuildCommand);
				if (result.error) {
					vscode.window.showErrorMessage('Cannot run pre-build command.');
					return;
				}
			}

			//Determine test suite to run
			const suite = this.findSuite(this.testSuiteInfo, tests[0]);

			//Build test suite
			if (suite !== undefined && suite.type === 'suite') {
				let result = await this.buildTest(suite);
				this.outputChannel.append(result.stdout);
				this.outputChannel.append(result.stderr);
				if (result.error) {
					vscode.window.showErrorMessage('Cannot build test executable.');
					return;
				}
			}

			// Get test executable file name without extension
			if (suite != undefined && suite.file != undefined) {
				g_debugTestExecutable = path.parse(suite.file).name.replace(new RegExp('(.*)'), this.testExecutableRegex);

				// Launch debugger
				if (!await vscode.debug.startDebugging(this.workspace, debugConfiguration))
					vscode.window.showErrorMessage('Debugger could not be started.');
			}
		}
		finally {
			// Reset current test executable
			g_debugTestExecutable = "";
		}
	}

	cancel(): void {
		if (this.buildProcess !== undefined) {
			if (this.buildProcess.pid !== undefined) {
				tree_kill(this.buildProcess.pid);
			}
		}
		if (this.suiteProcess !== undefined) {
			if (this.suiteProcess.pid !== undefined) {
				tree_kill(this.suiteProcess.pid);
			}
		}
	}

	dispose(): void {
		this.cancel();
		for (const disposable of this.disposables) {
			disposable.dispose();
		}
		this.disposables = [];
	}

	private getConfiguration(): vscode.WorkspaceConfiguration {
		return vscode.workspace.getConfiguration('unityExplorer', this.workspace.uri);
	}

	private getConfigurationString(name: string): string {
		const defaultResult = '';
		const result = this.getConfiguration().get<string>(name, defaultResult);
		return result;
	}

	private getConfigurationPath(name: string): string {
		const result = this.getConfigurationString(name);
		let workspacePath = this.workspace.uri.fsPath;
		return path.resolve(workspacePath, result);
	}

	private async getFileList(filePath: string, fileRegex: RegExp): Promise<string[]> {
		let filesAndFolders: string[] = [];
		let files: string[] = [];

		try {
			filesAndFolders = await fs.promises.readdir(filePath);
		} catch (err) {
			vscode.window.showErrorMessage('Cannot find test result path: ' + err);
			return [''];
		} finally {
			for (const item of filesAndFolders) {
				let fullPath = path.resolve(filePath, item);
				if ((await fs.promises.lstat(fullPath)).isFile()) {
					if (fileRegex.test(fullPath)) {
						files.push(fullPath);
					}
				}
				else {
					files = files.concat(await this.getFileList(fullPath, fileRegex));
				}
			}
		}

		return files;
	}

	private watchFilesForAutorun(files: string[]): void {
		for (const file of files) {
			if (!this.watchedFileForAutorunList.includes(file)) {
				this.watchedFileForAutorunList.push(file);
				const fullPath = path.resolve(this.workspace.uri.fsPath, file);
				fs.watchFile(fullPath, () => {
					this.autorunEmitter.fire();
				});
			}
		}
	}

	private watchFilesForReload(files: string[]): void {
		for (const file of files) {
			if (!this.watchedFileForReloadList.includes(file)) {
				this.watchedFileForReloadList.push(file);
				const fullPath = path.resolve(this.workspace.uri.fsPath, file);
				fs.watchFile(fullPath, () => {
					this.load();
				});
			}
		}
	}

	private setTestLabel(testName: string): string | undefined {
		let testLabel = testName;
		if (this.prettyTestCaseRegex != '') {
			const labeltestLabelRegex = new RegExp(this.prettyTestCaseRegex);
			let testLabelMatches = labeltestLabelRegex.exec(testName);
			if (testLabelMatches != null) {
				testLabel = testLabelMatches[1];
			}
		}
		return testLabel;
	}

	private setFileLabel(fileName: string): string {
		let fileLabel = path.relative(this.workspace.uri.fsPath, fileName);
		if (this.prettyTestFileRegex != '') {
			const labelFileRegex = new RegExp(this.prettyTestFileRegex);
			let labelMatches = labelFileRegex.exec(fileName);
			if (labelMatches != null) {
				fileLabel = labelMatches[1];
			}
		}
		return fileLabel;
	}
}

let g_debugTestExecutable: string = "";

export function getDebugTestExecutable(): string {
	return g_debugTestExecutable;
}
