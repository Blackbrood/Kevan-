const { spawnSync, spawn } = require('child_process')
const { existsSync, readFileSync, writeFileSync } = require('fs')
const path = require('path')

const SESSION_ID = 'updateThis' // Edit this line only, don't remove ' <- this symbol


let nodeRestartCount = 0
const maxNodeRestarts = 5
const restartWindow = 30000
let lastRestartTime = Date.now()

function startNode() {
  const child = spawn('node', ['index.js'], {
    cwd: 'patron-md',
    stdio: 'inherit',
  })

  child.on('exit', (code) => {
    if (code !== 0) {
      const currentTime = Date.now()
      if (currentTime - lastRestartTime > restartWindow) nodeRestartCount = 0
      lastRestartTime = currentTime
      nodeRestartCount++

      if (nodeRestartCount > maxNodeRestarts) {
        console.error('Node.js is restarting too much. Stopping...')
        return
      }

      console.log(`Node.js exited with code ${code}. Restarting... (Attempt ${nodeRestartCount})`) 
      startNode()
    }
  })
}

function startPm2() {
  const pm2 = spawn('yarn', [
    'pm2',
    'start',
    'index.js',
    '--name',
    'PATRON-MD',
    '--attach',
  ], {
    cwd: 'PATRON-MD',
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  let restartCount = 0
  const maxRestarts = 5

  pm2.on('exit', (code) => {
    if (code !== 0) startNode()
  })

  pm2.on('error', (error) => {
    console.error(`yarn pm2 error: ${error.message}`)
    startNode()
  })

  if (pm2.stderr) {
    pm2.stderr.on('data', (data) => {
      const output = data.toString()
      if (output.includes('restart')) {
        restartCount++
        if (restartCount > maxRestarts) {
          spawnSync('yarn', ['pm2', 'delete', 'PATRON-MD'], {
            cwd: 'PATRON-MD',
            stdio: 'inherit',
          })
          startNode()
        }
      }
    })
  }

  if (pm2.stdout) {
    pm2.stdout.on('data', (data) => {
      const output = data.toString()
      console.log(output)
      if (output.includes('Connecting')) restartCount = 0
    })
  }
}

function installDependencies() {
  const installResult = spawnSync(
    'yarn',
    ['install', '--force', '--non-interactive', '--network-concurrency', '3'],
    {
      cwd: 'PATRON-MD',
      stdio: 'inherit',
      env: { ...process.env, CI: 'true' },
    }
  )

  if (installResult.error || installResult.status !== 0) {
    console.error(`Failed to install dependencies: ${installResult.error?.message || 'Unknown error'}`)
    process.exit(1)
  }
}

function checkDependencies() {
  if (!existsSync(path.resolve('PATRON-MD/package.json'))) {
    console.error('package.json not found!')
    process.exit(1)
  }

  const result = spawnSync('yarn', ['check', '--verify-tree'], {
    cwd: 'PATRON-MD',
    stdio: 'inherit',
  })

  if (result.status !== 0) {
    console.log('Dependencies are missing or broken. Reinstalling...')
    installDependencies()
  }
}

function updateConfigFile() {
  const configPath = path.join('PATRON-MD', 'config.js')
  if (!existsSync(configPath)) {
    console.error('config.js not found in patron-md!')
    process.exit(1)
  }

  let configData = readFileSync(configPath, 'utf-8')

  const updatedConfig = configData.replace(
    /SESSION_ID:\s*process\.env\.SESSION_ID\s*\|\| *["'].*?["']/, 
    `SESSION_ID: process.env.SESSION_ID || "${SESSION_ID}"`
  )

  writeFileSync(configPath, updatedConfig)
  console.log('✅ config.js updated with SESSION_ID')
}

function cloneRepository() {
  const cloneResult = spawnSync(
    'git',
    ['clone', 'https://github.com/Itzpatron/PATRON-MD2.git', 'PATRON-MD'],
    { stdio: 'inherit' }
  )

  if (cloneResult.error) {
    throw new Error(`Failed to clone: ${cloneResult.error.message}`)
  }

  installDependencies()
  updateConfigFile()
}

// Boot sequence
if (!existsSync('patron-md')) {
  cloneRepository()
  checkDependencies()
} else {
  updateConfigFile()
  checkDependencies()
}

startPm2()
