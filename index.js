#!/usr/bin/env node

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const mountedDirectory = '/data/';

const file = process.argv.pop();
const absolutePath = path.resolve(file);
const directory = path.dirname(absolutePath);
const config = JSON.parse(fs.readFileSync(absolutePath));

validateConfig(config);

const isFtp = config.type === 'ftp';
const buildDirectoryCommand = isFtp ? buildDirectoryCommandFTP : buildDirectoryCommandSSH;
const buildFileCommand = isFtp ? buildFileCommandFTP : buildFileCommandSSH;

const commands = [
  ...(config.up?.directories || []).map((_) => buildDirectoryCommand(_, false)),
  ...(config.up?.files || []).map((_) => buildFileCommand(_, false)),
  ...(config.down?.directories || []).map((_) => buildDirectoryCommand(_, true)),
  ...(config.down?.files || []).map((_) => buildFileCommand(_, true)),
];

const dockerArgument = commands.join(' && ');
const volume = `-v ${directory}:${mountedDirectory}`;
const dockerCommand = `docker run --rm ${volume} sam/allsync /bin/bash -c "${dockerArgument}"`;

(async () => await execCommand(dockerCommand))();

//
// METHODS
//

function validateConfig(config) {
  // todo
}

function getCommonData(commandConfig, isDownload, isFTP) {
  const protocolPrefix = isFTP ? ':ftp:' : `${config.user}@${config.host}:`;
  const remotePrefix = `${protocolPrefix}${config.remotePrefix || ''}`;
  const localPrefix = `${mountedDirectory}${config.localPrefix || ''}`;
  const sourcePrefix = isDownload ? remotePrefix : localPrefix;
  const destinationPrefix = isDownload ? localPrefix : remotePrefix;
  const sourceSuffix = commandConfig.source;
  const destinationSuffix = commandConfig.destin || sourceSuffix;
  const source = `${sourcePrefix}${sourceSuffix}`;
  const destination = `${destinationPrefix}${destinationSuffix}`;
  return { source, destination };
}

function buildCommandFTP(commandConfig, isDownload, isSingleFile) {
  let excludes = '';
  if (commandConfig.excludes) {
    commandConfig.excludes.forEach(exclude => {
      excludes += `--exclude="${exclude}" `;
    });
  }

  const dryRun = config.dry ? '--dry-run' : '';
  const verbose = config.verbose ? '-vv' : '';
  const rcloneCommand = isSingleFile ? 'copyto' : 'sync';
  const { source, destination } = getCommonData(commandConfig, isDownload, true);
  return `rclone ${rcloneCommand} ${source} ${destination} `
      + `--ftp-host=${config.host} --ftp-user=${config.user} --ftp-pass=\`rclone obscure ${config.password}\` `
      + `${excludes} ${dryRun} ${verbose} -L`;
}

function buildFileCommandSSH(commandConfig, isDownload) {
  const { source, destination } = getCommonData(commandConfig, isDownload);
  const command = `sshpass -p "${config.password}" scp -o StrictHostKeyChecking=no ${source} ${destination}`;
  return config.dry
         ? `echo "dry run: ${command.replace(/"/g, '\x22')}"`
         : command;
}

function buildFileCommandFTP(commandConfig, isDownload) {
  return buildCommandFTP(commandConfig, isDownload, true);
}

function buildDirectoryCommandSSH(commandConfig, isDownload) {
  let excludes = '';
  if (commandConfig.excludes) {
    commandConfig.excludes.forEach(exclude => {
      excludes += `--exclude="${exclude}" `;
    });
  }

  const dryRun = config.dry ? '--dry-run' : '';
  const verbose = config.verbose ? '--verbose' : '';
  const { source, destination } = getCommonData(commandConfig, isDownload);
  const password = `--rsh='sshpass -p "${config.password}" ssh -o StrictHostKeyChecking=no'`;

  return `rsync -avzh ${password} --delete-after ${verbose} ${dryRun} ${excludes} ${source} ${destination}`;
}

function buildDirectoryCommandFTP(commandConfig, isDownload) {
  return buildCommandFTP(commandConfig, isDownload, false);
}

function log(data) {
  process.stdout.write(data);
}

function execCommand(command) {
  return new Promise((resolve, reject) => {
    console.log(command);
    const child = exec(command, { maxBuffer: 1024 * 10240 }, (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
    child.stdout.on('data', log);
    child.stderr.on('data', log);
  });
}
