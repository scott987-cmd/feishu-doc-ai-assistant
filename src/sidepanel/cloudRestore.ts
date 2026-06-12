/**
 * 企业云备份的 UI 层组合：把云端的产物拉回并按 id 并集合并进本地（只补不覆盖）。
 * 放在 sidepanel 层（而非 shared/artifactSync）是为了不让通用同步模块反向依赖具体 store，避免环引用。
 * 全部 no-op off：HAS_ARTIFACT_SYNC 关时下面的 restoreAndMerge 直接返回 0，store/BYO 构建零影响。
 */
import { HAS_ARTIFACT_SYNC } from '../shared/config'
import { restoreAndMerge } from '../shared/artifactSync'
import { getValidUserToken } from '../shared/feishu/auth'
import { loadVizList, replaceVizList } from '../shared/dataviz/store'
import { loadDecks, replaceDecks } from '../shared/ai/slidesStore'

/** 手动「从企业云端恢复」：拉回小程序/网站/看板(dataviz) + PPT(slides)，返回新增条数合计。 */
export async function restoreAllArtifacts(): Promise<number> {
  const [a, b] = await Promise.all([
    restoreAndMerge('dataviz', loadVizList, replaceVizList),
    restoreAndMerge('slides', loadDecks, replaceDecks),
  ])
  return a + b
}

const FLAG = '_artifact_autorestored_v1'
const getFlag = (): Promise<boolean> => new Promise((r) => { try { chrome.storage.local.get([FLAG], (x) => r(!!x?.[FLAG])) } catch { r(false) } })
const setFlag = (): Promise<void> => new Promise((r) => { try { chrome.storage.local.set({ [FLAG]: 1 }, () => r()) } catch { r() } })

/**
 * 本地丢失自动恢复：每个安装只跑一次（清缓存/重装会清掉标记 → 再次触发，正是我们想要的）。
 * 仅当本地两类都为空、且已授权时才从云端拉回；未授权则不设标记，下次再试。返回恢复条数。
 */
export async function autoRestoreOnceOnEmpty(): Promise<number> {
  if (!HAS_ARTIFACT_SYNC) return 0
  if (await getFlag()) return 0
  const [viz, decks] = await Promise.all([loadVizList(), loadDecks()])
  if (viz.length || decks.length) { await setFlag(); return 0 } // 本地已有东西 → 不自动拉，标记完成
  const token = await getValidUserToken()
  if (!token) return 0 // 还没授权 → 不设标记，授权后下次再试
  const n = await restoreAllArtifacts()
  await setFlag()
  return n
}
