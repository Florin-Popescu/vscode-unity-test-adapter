# C Unity Framework Test Adapter for Visual Studio Code

## Warning!
This extension is for the C Unit Test Framework by [ThrowTheSwitch.org](http://www.throwtheswitch.org/), not for the Video Engine.

Run your [Unity](http://www.throwtheswitch.org/unity) tests using the
[Test Explorer](https://marketplace.visualstudio.com/items?itemName=hbenl.vscode-test-explorer) extension.

![Screenshot](img/screenshot.png)

## Features

* Shows a Test Explorer in the Test view in VS Code's sidebar with all detected tests and suites and their state
* Adds CodeLenses to your test files for starting and debugging tests
* Adds Gutter decorations to your test files showing the tests' state
* Adds line decorations to the source line where a test failed
* Shows a failed test's log when the test is selected in the explorer
* Lets you choose test suites that should be run automatically after each file change

## Getting started

* Install the extension and restart VS Code
* Open the workspace or folder containing your Ceedling project
* [Configure](#options) the extension based on your project's needs
* Open the Test view
* Run your tests using the ![Run](img/run.png) icons in the Test Explorer or the CodeLenses in your test file

## Configuration

### Options

Property                                | Description
----------------------------------------|---------------------------------------------------------------
`unityExplorer.debugConfiguration`      | The Debug configuration to run during debugging. See [Debugging](#debugging) for more info.
`unityExplorer.foldersCommandArgs`      | If you have folders needed for any make output and they are created through a makefile rule, set here the arguments that need to be passed to `make` for this. If empty, no command will be run.
`unityExplorer.makeCwdPath`             | The current working directory where `make` will be run in. By default (or if this option is set to `null`) the same path as the workspace folder is used.
`unityExplorer.prettyTestFileLabel`     | The test file label is prettier in the test explorer, that mean the label is shorter, without begin prefix, path and file type. E.g. inactive `test/LEDs/test_BlinkTask.c`, active `BlinkTask` <br> Inactive: <br> ![prettyTestFileLabelInactive](img/prettyTestFileLabelInactive.png) <br> Active: <br> ![prettyTestFileLabelActive](img/prettyTestFileLabelActive.png)
`unityExplorer.prettyTestLabel`         | The test label is prettier in the test explorer, that mean the label is shorter and without begin prefix. E.g. inactive `test_BlinkTaskShouldToggleLed`, active `BlinkTaskShouldToggleLed` <br> Inactive: <br> ![prettyTestLabelInactive](img/prettyTestLabelInactive.png) <br> Active: <br> ![prettyTestLabelActive](img/prettyTestLabelActive.png)
`unityExplorer.projectSourcePath`       | The path to the C source files. By default (or if this option is set to `null`) the same path as the workspace folder is used.
`unityExplorer.testBuildCommandArgs`    | Any additional arguments that need to be passed to `make` when building a test. Note that the test executable target is already passed to make, so there is no need to add it here.
`unityExplorer.testBuildPath`           | The path to the test build output files. By default (or if this option is set to `null`) the same path as the workspace folder is used.
`unityExplorer.testSourcePath`          | The path to the unit test source files. By default (or if this option is set to `null`) the same path as the workspace folder is used.

## Commands

The following commands are available in VS Code's command palette, use the ID to add them to your keyboard shortcuts:

ID                                 | Command
-----------------------------------|--------------------------------------------
`test-explorer.reload`             | Reload tests
`test-explorer.run-all`            | Run all tests
`test-explorer.run-file`           | Run tests in current file
`test-explorer.run-test-at-cursor` | Run the test at the current cursor position
`test-explorer.cancel`             | Cancel running tests

## Debugging

To set up debugging, create a new Debug Configuration.
`${command:unityExplorer.debugTestExecutable}` can be used access the test executable filename being ran, with the relative path to it configured by `unityExplorer.testBuildPath`.
Then, edit the `unityExplorer.debugConfiguration` settings with the name of the Debug Configuration to run during debug.

Note: Individual test debugging is not supported. Instead the entire test file will be ran, so skip or remove breakpoints accordingly.

Example configuration for `gdb`:
```json
{
    "name": "Unity Test Explorer Debug",
    "type": "cppdbg",
    "request": "launch",
    "program": "${workspaceFolder}/${command:unityExplorer.debugTestExecutable}",
    "args": [],
    "stopAtEntry": false,
    "cwd": "${workspaceFolder}",
    "environment": [],
    "externalConsole": false,
    "MIMode": "gdb",
    "miDebuggerPath": "C:/MinGW/bin/gdb.exe",
    "setupCommands": [
        {
            "description": "Enable pretty-printing for gdb",
            "text": "-enable-pretty-printing",
            "ignoreFailures": true
        }
    ]
}
```

## Troubleshooting

If you think you've found a bug, please [file a bug report](https://github.com/https://github.com/Florin-Popescu/vscode-unity-test-adapter/issues).

Project inspired by [vscode-ceedling-test-adapter](https://github.com/numaru/vscode-ceedling-test-adapter)
