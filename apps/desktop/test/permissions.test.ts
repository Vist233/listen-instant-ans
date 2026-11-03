import assert from 'node:assert/strict'
import test from 'node:test'
import { isAllowedPermission, isAllowedPermissionCheck } from '../src/permissions.js'

const origin = 'http://127.0.0.1:3100'
const page = `${origin}/`

test('the microphone is allowed for our own page', () => {
  assert.equal(isAllowedPermission('media', { requestingUrl: page, mediaTypes: ['audio'] }, origin), true)
  assert.equal(isAllowedPermissionCheck('media', origin, { requestingUrl: page, mediaType: 'audio' }, origin), true)
})

test('the camera is never allowed, alone or together with the microphone', () => {
  assert.equal(isAllowedPermission('media', { requestingUrl: page, mediaTypes: ['video'] }, origin), false)
  assert.equal(isAllowedPermission('media', { requestingUrl: page, mediaTypes: ['audio', 'video'] }, origin), false)
  assert.equal(isAllowedPermissionCheck('media', origin, { requestingUrl: page, mediaType: 'video' }, origin), false)
})

test('a request that does not say what it wants is refused', () => {
  assert.equal(isAllowedPermission('media', { requestingUrl: page }, origin), false)
  assert.equal(isAllowedPermission('media', { requestingUrl: page, mediaTypes: [] }, origin), false)
  assert.equal(isAllowedPermissionCheck('media', origin, { requestingUrl: page, mediaType: 'unknown' }, origin), false)
})

test('other pages never get the microphone', () => {
  for (const url of ['https://evil.example.com/', 'http://127.0.0.1:9999/', 'http://localhost:3100/', 'file:///etc/passwd', '', 'not a url']) {
    assert.equal(isAllowedPermission('media', { requestingUrl: url, mediaTypes: ['audio'] }, origin), false, url)
  }
  assert.equal(isAllowedPermission('media', { mediaTypes: ['audio'] }, origin), false)
})

test('every other permission is refused', () => {
  for (const permission of ['geolocation', 'notifications', 'clipboard-read', 'midi', 'openExternal', 'fullscreen', 'display-capture', 'hid', 'usb', 'serial']) {
    assert.equal(isAllowedPermission(permission, { requestingUrl: page, mediaTypes: ['audio'] }, origin), false, permission)
    assert.equal(isAllowedPermissionCheck(permission, origin, { requestingUrl: page, mediaType: 'audio' }, origin), false, permission)
  }
})
