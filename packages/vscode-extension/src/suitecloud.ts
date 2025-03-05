/*
 ** Copyright (c) 2024 Oracle and/or its affiliates.  All rights reserved.
 ** Licensed under the Universal Permissive License v 1.0 as shown at https://oss.oracle.com/licenses/upl.
 */

// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import AddDependencies from './commands/AddDependencies';
import BaseAction from './commands/BaseAction';
import CompareFile from './commands/CompareFile';
import CreateFile from './commands/CreateFile';
import CreateProject from './commands/CreateProject';
import Deploy from './commands/Deploy';
import ImportFiles from './commands/ImportFiles';
import ImportObjects from './commands/ImportObjects';
import ListFiles from './commands/ListFiles';
import ListObjects from './commands/ListObjects';
import ManageAuth from './commands/ManageAuth';
import SetupAccount from './commands/SetupAccount';
import UpdateFile from './commands/UpdateFile';
import UpdateObject from './commands/UpdateObject';
import UploadFile from './commands/UploadFile';
import Validate from './commands/Validate';
import { installIfNeeded } from './core/sdksetup/SdkServices';
import { EXTENSION_INSTALLATION } from './service/TranslationKeys';
import { VSTranslationService } from './service/VSTranslationService';
import { showSetupAccountWarningMessageIfNeeded } from './startup/ShowSetupAccountWarning';
import { FILES } from './ApplicationConstants';
import { createAuthIDStatusBar, createSuiteCloudProjectStatusBar, updateAuthIDStatusBarIfNeeded, updateStatusBars } from './startup/StatusBarItemsFunctions';

import { MockDebugSession } from './debugger/mockDebug';
import { activateMockDebug, workspaceFileAccessor } from './debugger/activateMockDebug';
import * as Net from 'net';
import { randomBytes } from 'crypto';
import { ProviderResult } from 'vscode';
import { join } from 'path';
import { platform } from 'process';
import { tmpdir } from 'os';

const SCLOUD_OUTPUT_CHANNEL_NAME = 'SuiteCloud';
export const output: vscode.OutputChannel = vscode.window.createOutputChannel(SCLOUD_OUTPUT_CHANNEL_NAME);

const translationService = new VSTranslationService();

function register<T extends BaseAction>(command: string, action: T) {
	return vscode.commands.registerCommand(command, (uri?: vscode.Uri) => {
		if (!sdkDependenciesDownloadedAndValidated) {
			vscode.window.showWarningMessage(translationService.getMessage(EXTENSION_INSTALLATION.WARNING.VALIDATING_SDK_DEPENDENCIES));
			return;
		}
		// Called from a context menu, we receive uri info related to the selected file.
		action.run(uri);
	});
}

/*
 * The compile time flag 'runMode' controls how the debug adapter is run.
 * Please note: the test suite only supports 'external' mode.
 */
const runMode: 'external' | 'server' | 'namedPipeServer' | 'inline' = 'inline';

let sdkDependenciesDownloadedAndValidated = false;
// this method is called when SuiteCloud extension is activated
// the extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
	installIfNeeded().then(() => {
		sdkDependenciesDownloadedAndValidated = true;
		showSetupAccountWarningMessageIfNeeded();
	});

	// initialize status bars
	const suitecloudProjectStatusBar = createSuiteCloudProjectStatusBar();
	const authIDStatusBar = createAuthIDStatusBar();
	updateStatusBars(vscode.window.activeTextEditor, suitecloudProjectStatusBar, authIDStatusBar);

	// register commands
	context.subscriptions.push(
		register('suitecloud.adddependencies', new AddDependencies()),
		register('suitecloud.comparefile', new CompareFile()),
		register('suitecloud.createfile', new CreateFile()),
		register('suitecloud.createproject', new CreateProject()),
		register('suitecloud.deploy', new Deploy()),
		register('suitecloud.importfiles', new ImportFiles()),
		register('suitecloud.importobjects', new ImportObjects()),
		register('suitecloud.listfiles', new ListFiles()),
		register('suitecloud.listobjects', new ListObjects()),
		register('suitecloud.manageauth', new ManageAuth()),
		register('suitecloud.setupaccount', new SetupAccount()),
		register('suitecloud.updatefile', new UpdateFile()),
		register('suitecloud.updateobject', new UpdateObject()),
		register('suitecloud.uploadfile', new UploadFile()),
		register('suitecloud.validate', new Validate())
	);

	// add watchers needed to update the status bars
	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor((textEditor) => updateStatusBars(textEditor, suitecloudProjectStatusBar, authIDStatusBar)),
		vscode.workspace.createFileSystemWatcher(`**/${FILES.PROJECT_JSON}`).onDidChange((uri) => updateAuthIDStatusBarIfNeeded(uri, authIDStatusBar))
	);

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('SuiteCloud Extension for Visual Studio Code has been activated.');



	// debug adapters can be run in different ways by using a vscode.DebugAdapterDescriptorFactory:
	switch (runMode) {
		case 'server':
			// run the debug adapter as a server inside the extension and communicate via a socket
			activateMockDebug(context, new MockDebugAdapterServerDescriptorFactory());
			break;

		case 'namedPipeServer':
			// run the debug adapter as a server inside the extension and communicate via a named pipe (Windows) or UNIX domain socket (non-Windows)
			activateMockDebug(context, new MockDebugAdapterNamedPipeServerDescriptorFactory());
			break;

		case 'external': default:
			// run the debug adapter as a separate process
			activateMockDebug(context, new DebugAdapterExecutableFactory());
			break;

		case 'inline':
			// run the debug adapter inside the extension and directly talk to it
			activateMockDebug(context);
			break;
	}
}

// this method is called when SuiteCloud extension is deactivated
export function deactivate() {}

class DebugAdapterExecutableFactory implements vscode.DebugAdapterDescriptorFactory {

	// The following use of a DebugAdapter factory shows how to control what debug adapter executable is used.
	// Since the code implements the default behavior, it is absolutely not neccessary and we show it here only for educational purpose.

	createDebugAdapterDescriptor(_session: vscode.DebugSession, executable: vscode.DebugAdapterExecutable | undefined): ProviderResult<vscode.DebugAdapterDescriptor> {
		// param "executable" contains the executable optionally specified in the package.json (if any)

		// use the executable specified in the package.json if it exists or determine it based on some other information (e.g. the session)
		if (!executable) {
			const command = "absolute path to my DA executable";
			const args = [
				"some args",
				"another arg"
			];
			const options = {
				cwd: "working directory for executable",
				env: { "envVariable": "some value" }
			};
			executable = new vscode.DebugAdapterExecutable(command, args, options);
		}

		// make VS Code launch the DA executable
		return executable;
	}
}

class MockDebugAdapterServerDescriptorFactory implements vscode.DebugAdapterDescriptorFactory {

	private server?: Net.Server;

	createDebugAdapterDescriptor(session: vscode.DebugSession, executable: vscode.DebugAdapterExecutable | undefined): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {

		if (!this.server) {
			// start listening on a random port
			this.server = Net.createServer(socket => {
				const session = new MockDebugSession(workspaceFileAccessor);
				session.setRunAsServer(true);
				session.start(socket as NodeJS.ReadableStream, socket);
			}).listen(0);
		}

		// make VS Code connect to debug server
		return new vscode.DebugAdapterServer((this.server.address() as Net.AddressInfo).port);
	}

	dispose() {
		if (this.server) {
			this.server.close();
		}
	}
}

class MockDebugAdapterNamedPipeServerDescriptorFactory implements vscode.DebugAdapterDescriptorFactory {

	private server?: Net.Server;

	createDebugAdapterDescriptor(session: vscode.DebugSession, executable: vscode.DebugAdapterExecutable | undefined): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {

		if (!this.server) {
			// start listening on a random named pipe path
			const pipeName = randomBytes(10).toString('utf8');
			const pipePath = platform === "win32" ? join('\\\\.\\pipe\\', pipeName) : join(tmpdir(), pipeName);

			this.server = Net.createServer(socket => {
				const session = new MockDebugSession(workspaceFileAccessor);
				session.setRunAsServer(true);
				session.start(<NodeJS.ReadableStream>socket, socket);
			}).listen(pipePath);
		}

		// make VS Code connect to debug server
		return new vscode.DebugAdapterNamedPipeServer(this.server.address() as string);
	}

	dispose() {
		if (this.server) {
			this.server.close();
		}
	}
}