var Services
if (typeof globalThis.Services !== 'undefined') {
  Services = globalThis.Services
} else {
  try {
    ;({ Services } = ChromeUtils.importESModule(
      'resource://gre/modules/Services.sys.mjs'
    ))
  } catch (_error) {
    ;({ Services } = ChromeUtils.import('resource://gre/modules/Services.jsm'))
  }
}

var listen2papersPlugin = {
  id: 'listen2papers@listen2papers.com',
  menuId: 'listen2papers-send-to-listen2papers',
  menuLabel: 'Listen in listen2papers',
  maxUploadBytes: 25 * 1024 * 1024,
  registeredMenuId: null,
  fallbackMenuItem: null,

  async startup() {
    await Zotero.uiReadyPromise
    this.registerMenu()
  },

  shutdown() {
    this.unregisterMenu()
  },

  registerMenu() {
    if (Zotero.MenuManager?.registerMenu) {
      try {
        const registeredMenuId = Zotero.MenuManager.registerMenu({
          pluginID: this.id,
          menuID: this.menuId,
          target: 'main/library/item',
          menus: [
            {
              menuType: 'menuitem',
              l10nID: 'listen2papers-menu-send',
              onShowing: (_event, context) => {
                const items = context?.items || []
                context?.menuElem?.setAttribute?.('label', this.menuLabel)
                context?.setVisible?.(items.length === 1)
              },
              onCommand: (_event, context) =>
                this.sendSelectedPdf(context?.items || null),
            },
          ],
        })
        if (registeredMenuId) {
          this.registeredMenuId = registeredMenuId
          return
        }
        Zotero.debug('listen2papers MenuManager registration returned false')
      } catch (error) {
        Zotero.debug(`listen2papers MenuManager registration failed: ${error}`)
      }
    }

    this.registerFallbackMenu()
  },

  registerFallbackMenu() {
    const win =
      Services.wm.getMostRecentWindow('navigator:browser') ||
      Services.wm.getMostRecentWindow('zotero:main')
    const doc = win?.document
    const itemMenu = doc?.getElementById('zotero-itemmenu')
    if (!doc || !itemMenu || doc.getElementById(this.menuId)) return

    const menuItem = doc.createXULElement('menuitem')
    menuItem.id = this.menuId
    menuItem.setAttribute('label', this.menuLabel)
    menuItem.addEventListener('command', () => this.sendSelectedPdf())
    itemMenu.appendChild(menuItem)
    this.fallbackMenuItem = menuItem
  },

  unregisterMenu() {
    if (Zotero.MenuManager?.unregisterMenu && this.registeredMenuId) {
      try {
        Zotero.MenuManager.unregisterMenu(this.registeredMenuId)
      } catch (error) {
        Zotero.debug(`listen2papers MenuManager unregister failed: ${error}`)
      }
    }
    this.registeredMenuId = null

    this.fallbackMenuItem?.remove()
    this.fallbackMenuItem = null
  },

  getPref(name) {
    return Zotero.Prefs.get(`extensions.listen2papers.${name}`, true)
  },

  setPref(name, value) {
    Zotero.Prefs.set(`extensions.listen2papers.${name}`, value, true)
  },

  normalizeApiBaseUrl(value) {
    const trimmed = String(value || '').trim()
    if (!trimmed) return ''
    const hasSupportedScheme = /^https?:\/\//i.test(trimmed)
    const hasMalformedSupportedScheme =
      /^https?:/i.test(trimmed) && !hasSupportedScheme
    const looksLikeHostPort = /^[^/:?#]+:\d+(?:[/?#]|$)/.test(trimmed)
    const hasUnsupportedScheme =
      (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ||
        (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !looksLikeHostPort)) &&
      !hasSupportedScheme
    if (hasMalformedSupportedScheme || hasUnsupportedScheme) return ''
    const candidate = hasSupportedScheme ? trimmed : `https://${trimmed}`
    const URLCtor = globalThis.URL || this.getBrowserWindow()?.URL
    if (!URLCtor) return ''

    try {
      const url = new URLCtor(candidate)
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        !url.hostname ||
        url.username ||
        url.password
      ) {
        return ''
      }
      return url.origin
    } catch (_error) {
      return ''
    }
  },

  normalizeToken(value) {
    return String(value || '')
      .trim()
      .replace(/^Bearer(?:\s+|$)/i, '')
      .trim()
  },

  autoGenerateAudioEnabled(value) {
    if (value === false) return false
    if (typeof value === 'string') {
      return !['false', '0', 'no', 'off'].includes(
        value.trim().toLowerCase()
      )
    }
    return true
  },

  alert(message) {
    Services.prompt.alert(null, 'listen2papers', message)
  },

  errorMessage(error) {
    if (error?.message) return error.message
    if (error === null || typeof error === 'undefined') return 'Unknown error'
    return String(error)
  },

  uploadResponseErrorMessage(response, payload) {
    return (
      payload.details ||
      payload.error ||
      response.statusText ||
      (response.status ? `HTTP ${response.status}` : 'Upload failed')
    )
  },

  async parseUploadResponseJson(response) {
    if (!response?.json) return {}
    return (await response.json().catch(() => ({}))) || {}
  },

  validReaderUrl(apiBaseUrl, documentUrl) {
    if (!documentUrl) {
      throw new Error('Upload response did not include a document URL')
    }

    const win = this.getBrowserWindow()
    const URLCtor = globalThis.URL || win?.URL
    if (!URLCtor) {
      throw new Error('URL parsing is not available in Zotero')
    }

    try {
      const apiUrl = new URLCtor(apiBaseUrl)
      const readerUrl = new URLCtor(String(documentUrl), apiUrl.href)
      if (
        readerUrl.origin !== apiUrl.origin ||
        readerUrl.pathname !== '/reader' ||
        readerUrl.username ||
        readerUrl.password ||
        !String(readerUrl.searchParams.get('id') || '').trim()
      ) {
        throw new Error('invalid reader URL')
      }
      return readerUrl.href
    } catch (_error) {
      throw new Error(
        'Upload response did not include a valid listen2papers reader URL'
      )
    }
  },

  getBrowserWindow() {
    return (
      Services.wm.getMostRecentWindow('navigator:browser') ||
      Services.wm.getMostRecentWindow('zotero:main') ||
      globalThis
    )
  },

  createFormData() {
    const win = this.getBrowserWindow()
    const FormDataCtor = globalThis.FormData || win?.FormData
    if (!FormDataCtor) throw new Error('FormData is not available in Zotero')
    return new FormDataCtor()
  },

  createPdfBlob(bytes) {
    const win = this.getBrowserWindow()
    const BlobCtor = globalThis.Blob || win?.Blob
    if (!BlobCtor) throw new Error('Blob is not available in Zotero')
    return new BlobCtor([bytes], { type: 'application/pdf' })
  },

  async postMultipart(url, options) {
    const win = this.getBrowserWindow()
    const fetchImpl = globalThis.fetch || win?.fetch
    if (!fetchImpl) throw new Error('fetch is not available in Zotero')
    return fetchImpl.call(win || globalThis, url, options)
  },

  getSelectedItems(contextItems) {
    if (Array.isArray(contextItems)) {
      return contextItems
    }
    const pane = Zotero.getActiveZoteroPane?.()
    const selected = pane?.getSelectedItems?.()
    return Array.isArray(selected) ? selected : []
  },

  async findLocalPdfAttachment(item) {
    if (!item) return { attachment: null, filePath: null, sawPdf: false }

    if (item.isAttachment?.()) {
      if (!this.isPdfAttachment(item)) {
        return { attachment: null, filePath: null, sawPdf: false }
      }
      return {
        attachment: item,
        filePath: await this.attachmentPath(item),
        sawPdf: true,
      }
    }

    let sawPdf = false
    let attachmentLookupError = null
    let pathLookupError = null
    const attachmentIds = item.getAttachments?.() || []
    for (const attachmentId of attachmentIds) {
      let attachment = null
      try {
        attachment = await Zotero.Items.getAsync(attachmentId)
      } catch (error) {
        Zotero.debug(
          `listen2papers attachment lookup failed for ${attachmentId}: ${error}`
        )
        attachmentLookupError = error
        continue
      }
      if (!this.isPdfAttachment(attachment)) continue

      sawPdf = true
      let filePath = null
      try {
        filePath = await this.attachmentPath(attachment)
      } catch (error) {
        Zotero.debug(
          `listen2papers attachment path lookup failed for ${attachment.key}: ${error}`
        )
        pathLookupError = error
        continue
      }
      if (filePath) return { attachment, filePath, sawPdf }
    }

    if (pathLookupError) throw pathLookupError
    if (!sawPdf && attachmentLookupError) throw attachmentLookupError
    return { attachment: null, filePath: null, sawPdf }
  },

  isPdfAttachment(item) {
    const contentType = String(
      item?.attachmentContentType || item?.getField?.('contentType') || ''
    )
      .split(';', 1)[0]
      .trim()
      .toLowerCase()
    const filename =
      item?.attachmentFilename || item?.getField?.('filename') || ''
    return (
      contentType === 'application/pdf' ||
      filename.toLowerCase().endsWith('.pdf')
    )
  },

  async attachmentPath(attachment) {
    if (attachment.getFilePathAsync) {
      return attachment.getFilePathAsync()
    }
    return attachment.getFilePath?.() || null
  },

  async localPdfExceedsUploadLimit(filePath) {
    if (!IOUtils.stat) return false
    try {
      const fileInfo = await IOUtils.stat(filePath)
      return Number(fileInfo?.size) > this.maxUploadBytes
    } catch (error) {
      Zotero.debug(`listen2papers file size lookup failed: ${error}`)
      return false
    }
  },

  async getMetadataItem(selectedItem, attachment) {
    if (!selectedItem?.isAttachment?.()) return selectedItem
    const parentItemID = selectedItem.parentItemID || attachment?.parentItemID
    if (!parentItemID) return selectedItem
    try {
      return (await Zotero.Items.getAsync(parentItemID)) || selectedItem
    } catch (error) {
      Zotero.debug(`listen2papers parent metadata lookup failed: ${error}`)
      return selectedItem
    }
  },

  async zoteroLibraryType(item, attachment) {
    const directLibraryType =
      item?.library?.libraryType || attachment?.library?.libraryType
    if (directLibraryType) return directLibraryType

    const libraryID = item?.libraryID || attachment?.libraryID
    if (!libraryID || !Zotero.Libraries?.get) return 'user'

    try {
      const library = await Promise.resolve(Zotero.Libraries.get(libraryID))
      return library?.libraryType || 'user'
    } catch (error) {
      Zotero.debug(`listen2papers library lookup failed: ${error}`)
      return 'user'
    }
  },

  async collectMetadata(item, attachment) {
    const creators = item?.getCreators?.() || []
    return {
      title:
        item?.getField?.('title') ||
        attachment?.attachmentFilename ||
        'Zotero PDF',
      zoteroItemKey: item?.key || attachment?.parentKey || attachment?.key || '',
      zoteroAttachmentKey: attachment?.key || '',
      zoteroLibraryId: String(item?.libraryID || attachment?.libraryID || ''),
      zoteroLibraryType: await this.zoteroLibraryType(item, attachment),
      doi: item?.getField?.('DOI') || '',
      url: item?.getField?.('url') || '',
      authors: JSON.stringify(
        creators.map((creator) => ({
          firstName: creator.firstName || '',
          lastName: creator.lastName || creator.name || '',
        }))
      ),
    }
  },

  async sendSelectedPdf(contextItems) {
    const rawApiBaseUrl = this.getPref('apiBaseUrl')
    const apiBaseUrl = this.normalizeApiBaseUrl(rawApiBaseUrl)
    const token = this.normalizeToken(this.getPref('token'))

    if (!apiBaseUrl && String(rawApiBaseUrl || '').trim()) {
      this.alert('Add a valid listen2papers API URL in the plugin preferences.')
      return
    }

    if (!apiBaseUrl || !token) {
      this.alert('Add a listen2papers plugin token in the plugin preferences.')
      return
    }

    const selectedItems = this.getSelectedItems(contextItems)
    if (selectedItems.length !== 1) {
      this.alert('Select exactly one Zotero item or PDF attachment.')
      return
    }

    try {
      const selectedItem = selectedItems[0]
      const localPdf = await this.findLocalPdfAttachment(selectedItem)
      if (!localPdf.sawPdf) {
        this.alert('Select a Zotero item with a local PDF attachment.')
        return
      }

      if (!localPdf.attachment || !localPdf.filePath) {
        this.alert('The selected PDF is not available locally.')
        return
      }
      const { attachment, filePath } = localPdf

      if (await this.localPdfExceedsUploadLimit(filePath)) {
        this.alert(
          "The selected PDF is larger than listen2papers' 25 MB upload limit."
        )
        return
      }

      const bytes = await IOUtils.read(filePath)
      const filename =
        attachment.attachmentFilename ||
        filePath.split(/[\\/]/).pop() ||
        'zotero-paper.pdf'
      const metadataItem = await this.getMetadataItem(selectedItem, attachment)
      const metadata = await this.collectMetadata(metadataItem, attachment)
      const body = this.createFormData()
      body.append('file', this.createPdfBlob(bytes), filename)
      body.append(
        'autoGenerateAudio',
        String(this.autoGenerateAudioEnabled(this.getPref('autoGenerateAudio')))
      )

      for (const [key, value] of Object.entries(metadata)) {
        if (value) body.append(key, value)
      }

      const response = await this.postMultipart(
        `${apiBaseUrl}/api/zotero-plugin/upload`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
          },
          body,
        }
      )

      const payload = await this.parseUploadResponseJson(response)
      if (!response.ok) {
        throw new Error(this.uploadResponseErrorMessage(response, payload))
      }

      Zotero.launchURL(this.validReaderUrl(apiBaseUrl, payload.documentUrl))
    } catch (error) {
      this.alert(
        `Could not send PDF to listen2papers: ${this.errorMessage(error)}`
      )
    }
  },
}

function install() {}

async function startup() {
  await listen2papersPlugin.startup()
}

function shutdown() {
  listen2papersPlugin.shutdown()
}

function uninstall() {}
