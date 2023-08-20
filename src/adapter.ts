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
} from 'vscode-test-adapter-api';
import { FileTracker } from './fileTracker';
import { TestLoader } from './testLoader';
import { TestRunner } from './testRunner';

export class UnityAdapter implements TestAdapter {
	private disposables: { dispose(): void }[] = [];

	private readonly testsEmitter = new vscode.EventEmitter<TestLoadStartedEvent | TestLoadFinishedEvent>();
	private readonly testStatesEmitter = new vscode.EventEmitter<TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent>();
	private readonly autorunEmitter = new vscode.EventEmitter<void>();

	private fileTracker: FileTracker;
	private testLoader: TestLoader;
	private testRunner: TestRunner;

	private testSuiteInfo: TestSuiteInfo = {
		type: 'suite',
		id: 'root',
		label: 'Unity',
		children: []
	};
	private unitUnderTestFolder: string = '.';
	private unitUnderTestFileRegex: string = '\\.[hc]';
	private testSourceFolder: string = '.';
	private testSourceFileRegex: string = '';
	private preBuildCommand: string = '';

	get tests(): vscode.Event<TestLoadStartedEvent | TestLoadFinishedEvent> { return this.testsEmitter.event; }
	get testStates(): vscode.Event<TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent> { return this.testStatesEmitter.event; }
	get autorun(): vscode.Event<void> | undefined { return this.autorunEmitter.event; }

	constructor(
		public readonly workspace: vscode.WorkspaceFolder,
		public readonly outputChannel: vscode.OutputChannel
	) {
		this.fileTracker = new FileTracker();
		this.testLoader = new TestLoader(this.getConfigurationString('prettyTestCaseRegex'), this.getConfigurationString('prettyTestFileRegex'), this.getConfigurationString('testCaseRegex'));
		this.testRunner = new TestRunner(this.getConfigurationString('testBuildApplication'), this.getConfigurationPath('testBuildCwdPath'), this.getConfigurationString('testBuildArgs'), this.getConfigurationString('testBuildTargetRegex'), this.getConfigurationString('testExecutableRegex'), this.getConfigurationString('testExecutableArgs'), this.getConfigurationString('testExecutableArgSingleCaseRegex'), this.getConfigurationString('debugConfiguration'));

		this.disposables.push(this.testsEmitter);
		this.disposables.push(this.testStatesEmitter);
		this.disposables.push(this.autorunEmitter);

		this.unitUnderTestFolder = this.getConfigurationPath('unitUnderTestFolder');
		this.unitUnderTestFileRegex = this.getConfigurationString('unitUnderTestFileRegex');
		this.testSourceFolder = this.getConfigurationPath('testSourceFolder');
		this.testSourceFileRegex = this.getConfigurationString('testSourceFileRegex');
		this.preBuildCommand = this.getConfigurationString('preBuildCommand');

		// callback when a config property is modified
		vscode.workspace.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration('unityExplorer.prettyTestCaseRegex')) {
				this.testLoader.prettyTestCaseRegex = this.getConfigurationString('prettyTestCaseRegex');
			}
			if (event.affectsConfiguration('unityExplorer.prettyTestFileRegex')) {
				this.testLoader.prettyTestFileRegex = this.getConfigurationString('prettyTestFileRegex');
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
				this.testLoader.testCaseRegex = this.getConfigurationString('testCaseRegex');
			}
			if (event.affectsConfiguration('unityExplorer.preBuildCommand')) {
				this.preBuildCommand = this.getConfigurationString('preBuildCommand');
			}
			if (event.affectsConfiguration('unityExplorer.testBuildApplication')) {
				this.testRunner.testBuildApplication = this.getConfigurationString('testBuildApplication');
			}
			if (event.affectsConfiguration('unityExplorer.testBuildCwdPath')) {
				this.testRunner.testBuildCwdPath = this.getConfigurationPath('testBuildCwdPath');
			}
			if (event.affectsConfiguration('unityExplorer.testBuildArgs')) {
				this.testRunner.testBuildArgs = this.getConfigurationString('testBuildArgs');
			}
			if (event.affectsConfiguration('unityExplorer.testBuildTargetRegex')) {
				this.testRunner.testBuildTargetRegex = this.getConfigurationString('testBuildTargetRegex');
			}
			if (event.affectsConfiguration('unityExplorer.testExecutableRegex')) {
				this.testRunner.testExecutableRegex = this.getConfigurationString('testExecutableRegex');
			}
			if (event.affectsConfiguration('unityExplorer.testExecutableArgs')) {
				this.testRunner.testExecutableArgs = this.getConfigurationString('testExecutableArgs');
			}
			if (event.affectsConfiguration('unityExplorer.testExecutableArgSingleCaseRegex')) {
				this.testRunner.testExecutableArgSingleCaseRegex = this.getConfigurationString('testExecutableArgSingleCaseRegex');
			}
			this.load();
		})
	}

	async load(): Promise<void> {
		this.testsEmitter.fire(<TestLoadStartedEvent>{ type: 'started' });

		const sourceFiles = await this.fileTracker.getFileList(this.unitUnderTestFolder, new RegExp(this.unitUnderTestFileRegex));
		const testFiles = await this.fileTracker.getFileList(this.testSourceFolder, new RegExp(this.testSourceFileRegex));

		for (const file of testFiles) {
			if (sourceFiles.indexOf(file) != 0) {
				sourceFiles.splice(sourceFiles.indexOf(file), 1);
			}
		}

		this.fileTracker.watchFilesForAutorun(this.workspace.uri.fsPath, sourceFiles);
		this.fileTracker.watchFilesForAutorun(this.workspace.uri.fsPath, testFiles);

		this.fileTracker.watchFilesForReload(this.workspace.uri.fsPath, testFiles, this.load);

		this.testSuiteInfo = await this.testLoader.loadTests(this.workspace.uri.fsPath, testFiles);

		this.testsEmitter.fire(<TestLoadFinishedEvent>{ type: 'finished', suite: this.testSuiteInfo });
	}

	async run(tests: string[]): Promise<void> {
		this.testStatesEmitter.fire(<TestRunStartedEvent>{ type: 'started', tests });

		this.outputChannel.clear();
		this.outputChannel.show();

		if (this.preBuildCommand != '') {
			let result = await this.testRunner.runCommand(this.workspace.uri.fsPath, this.preBuildCommand);
			if (result.error) {
				vscode.window.showErrorMessage('Cannot run pre-build command.');
				return;
			}
		}

		if (tests[0] === 'root') {
			for (const suite of this.testSuiteInfo.children) {
				if (suite.type === 'suite') {
					await this.testRunner.runSuites(this.testSuiteInfo, [suite.id], this.testStatesEmitter, this.workspace.uri.fsPath, this.outputChannel);
				}
			}
		}
		else {
			await this.testRunner.runSuites(this.testSuiteInfo, tests, this.testStatesEmitter, this.workspace.uri.fsPath, this.outputChannel);
		}

		this.testStatesEmitter.fire(<TestRunFinishedEvent>{ type: 'finished' });
	}

	async debug(tests: string[]): Promise<void> {
		const suite = this.testRunner.findSuite(this.testSuiteInfo, tests[0]);

		if (suite !== undefined) {
			if (this.preBuildCommand != '') {
				let result = await this.testRunner.runCommand(this.workspace.uri.fsPath, this.preBuildCommand);
				if (result.error) {
					vscode.window.showErrorMessage('Cannot run pre-build command.');
					return;
				}
			}

			this.testRunner.debug(suite, this.workspace, this.outputChannel);
		}
	}

	getDebugTestExecutable(): string {
		return this.testRunner.debugTestExecutable;
	}

	cancel(): void {
		this.testRunner.cancel();
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
}
