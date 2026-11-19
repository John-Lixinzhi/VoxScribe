const https = require('https')
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function isoDate(value) {
  if (!value) return new Date().toISOString()
  if (value instanceof Date) return value.toISOString()
  return new Date(value).toISOString()
}

function publicJob(data) {
  return {
    _id: data._id,
    fileName: data.fileName,
    fileSize: data.fileSize,
    status: data.status,
    progress: data.progress || 0,
    language: data.language,
    model: data.model,
    withSrt: data.withSrt !== false,
    createdAt: isoDate(data.createdAt),
    updatedAt: isoDate(data.updatedAt),
    error: data.error || undefined,
    result: data.result || undefined
  }
}

function normalizeResult(result) {
  if (!result) return null
  const duration = Number(result.duration || 0)
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('转写服务未返回有效媒体时长')
  return {
    text: String(result.text || ''),
    srt: String(result.srt || ''),
    json: typeof result.json === 'string' ? result.json : JSON.stringify(result.json || {}),
    duration,
    language: String(result.language || 'auto')
  }
}

function requestAsr(remoteJobId) {
  const baseUrl = (process.env.ASR_SERVICE_URL || '').replace(/\/$/, '')
  const token = process.env.ASR_SERVICE_TOKEN
  if (!baseUrl || !token) throw new Error('云端转写服务尚未配置')
  const url = new URL(`${baseUrl}/v1/transcriptions/${encodeURIComponent(remoteJobId)}`)
  if (url.protocol !== 'https:') throw new Error('ASR_SERVICE_URL 必须使用 HTTPS')

  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 25000
    }, (response) => {
      let text = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => {
        text += chunk
        if (text.length > 10 * 1024 * 1024) request.destroy(new Error('转写服务响应过大'))
      })
      response.on('end', () => {
        try {
          const result = JSON.parse(text || '{}')
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(result.detail || `转写服务返回 ${response.statusCode}`))
            return
          }
          resolve(result)
        } catch (error) {
          reject(new Error('转写服务返回了无效响应'))
        }
      })
    })
    request.on('timeout', () => request.destroy(new Error('转写服务请求超时')))
    request.on('error', reject)
  })
}

async function saveCompletedJob(jobId, openid, result) {
  const billedSeconds = Math.max(1, Math.ceil(result.duration))
  await db.runTransaction(async (transaction) => {
    const jobSnapshot = await transaction.collection('transcription_jobs').doc(jobId).get()
    const job = jobSnapshot.data
    const completedData = {
      status: 'completed',
      progress: 100,
      result,
      error: null,
      updatedAt: db.serverDate()
    }

    if (!job.billed) {
      const userSnapshot = await transaction.collection('users').doc(openid).get()
      const account = userSnapshot.data
      const remainingSeconds = Math.max(0, Number(account.remainingSeconds || 0) - billedSeconds)
      await transaction.collection('users').doc(openid).update({
        data: {
          remainingSeconds,
          usedSeconds: Number(account.usedSeconds || 0) + billedSeconds,
          updatedAt: db.serverDate()
        }
      })
      completedData.billed = true
      completedData.billedSeconds = billedSeconds
    }
    await transaction.collection('transcription_jobs').doc(jobId).update({ data: completedData })
  })
}

exports.main = async (event) => {
  try {
    const { OPENID: openid } = cloud.getWXContext()
    const jobId = String(event.id || '')
    if (!openid) throw new Error('无法识别用户身份')
    if (!jobId) throw new Error('缺少任务编号')

    const snapshot = await db.collection('transcription_jobs').doc(jobId).get()
    const job = snapshot.data
    if (!job || job._openid !== openid) throw new Error('转写任务不存在')
    if (job.status === 'completed' || job.status === 'failed' || !job.remoteJobId) {
      return { code: 0, message: 'success', data: { job: publicJob(job) } }
    }

    const remote = await requestAsr(job.remoteJobId)
    const status = ['queued', 'processing', 'completed', 'failed'].includes(remote.status)
      ? remote.status
      : 'processing'
    const progress = Math.max(0, Math.min(100, Math.round(Number(remote.progress || 0))))

    if (status === 'completed') {
      const result = normalizeResult(remote.result)
      await saveCompletedJob(jobId, openid, result)
    } else {
      await db.collection('transcription_jobs').doc(jobId).update({
        data: {
          status,
          progress: status === 'failed' ? progress : Math.max(Number(job.progress || 0), progress),
          error: status === 'failed' ? String(remote.error || '云端识别失败') : null,
          updatedAt: db.serverDate()
        }
      })
    }

    const latest = await db.collection('transcription_jobs').doc(jobId).get()
    return { code: 0, message: 'success', data: { job: publicJob(latest.data) } }
  } catch (error) {
    console.error('[getTranscription]', error)
    return { code: -1, message: error.message || '读取转写任务失败', data: null }
  }
}
