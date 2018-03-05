/* eslint-env jest */

import memdown from 'memdown'
import encode from 'encoding-down'
import * as fakeIDBFactory from 'fake-indexeddb'
import * as fakeIDBKeyRange from 'fake-indexeddb/lib/FDBKeyRange'
import db from '../pouchdb'
import * as search from './'
import * as oldIndex from './search-index-old'
import { exportPages as exportOldPages } from './search-index-old/export'
import { importPage as importNewPage } from './search-index-new/import'
import * as newIndex from './search-index-new'
import * as testData from './index.test.data'

async function doIntegrationTest() {
    const visit1 = Date.now().toString()
    await search.addPage({
        pageDoc: {
            _id: 'page/test-id-1',
            url: 'https://www.test.com/test',
            content: {
                fullText: 'the wild fox jumped over the hairy red hen',
                title: 'test page',
            },
        },
        bookmarkDocs: [],
        visits: [visit1],
    })
    const { docs: results1 } = await search.search({
        query: 'fox',
        mapResultsFunc: async results => results,
    })
    expect(results1).toEqual([
        expect.objectContaining({
            id: 'page/test-id-1',
            document: {
                id: 'page/test-id-1',
                terms: new Set([
                    'term/wild',
                    'term/fox',
                    'term/jumped',
                    'term/hairy',
                    'term/red',
                    'term/hen',
                ]),
                urlTerms: new Set(['url/test']),
                titleTerms: new Set(['title/test', 'title/page']),
                domain: 'domain/test.com',
                visits: new Set([`visit/${visit1}`]),
                bookmarks: new Set([]),
                tags: new Set([]),
                latest: visit1,
            },
        }),
    ]) // TODO: Why is score not deterministic?

    const visit2 = Date.now().toString()
    await search.addPage({
        pageDoc: {
            _id: 'page/test-id-2',
            url: 'https://www.test.com/test2',
            content: {
                fullText: 'the fox was wild',
                title: 'test page 2',
            },
        },
        bookmarkDocs: [],
        visits: [visit2],
    })
    const { docs: results2 } = await search.search({
        query: 'fox wild',
        mapResultsFunc: async results => results,
    })
    expect(results2).toEqual([
        expect.objectContaining({
            id: 'page/test-id-2',
            document: {
                id: 'page/test-id-2',
                terms: new Set(['term/fox', 'term/wild']),
                urlTerms: new Set([]),
                titleTerms: new Set(['title/test', 'title/page']),
                domain: 'domain/test.com',
                visits: new Set([`visit/${visit2}`]),
                bookmarks: new Set([]),
                tags: new Set([]),
                latest: visit2,
            },
        }),
        expect.objectContaining({
            id: 'page/test-id-1',
            document: expect.objectContaining({
                terms: new Set([
                    'term/wild',
                    'term/fox',
                    'term/jumped',
                    'term/hairy',
                    'term/red',
                    'term/hen',
                ]),
            }),
        }),
    ])

    await search.delPages(['page/test-id-2'])
    const { docs: results3 } = await search.search({
        query: 'fox wild',
        mapResultsFunc: async results => results,
    })
    expect(results3).toEqual([
        expect.objectContaining({
            id: 'page/test-id-1',
            document: expect.objectContaining({
                terms: new Set([
                    'term/wild',
                    'term/fox',
                    'term/jumped',
                    'term/hairy',
                    'term/red',
                    'term/hen',
                ]),
            }),
        }),
    ])
}

describe('Old search index', () => {
    test('Integration test', async () => {
        search.getBackend._reset({ useOld: true })
        oldIndex.init({ levelDown: memdown() })
        await doIntegrationTest()
    })

    test('Exporting data', async () => {
        search.getBackend._reset({ useOld: true })
        oldIndex.init({ levelDown: memdown() })
        await db.erase()
        await db.put(testData.PAGE_DOC_1)

        const visit1 = Date.now()
        const bookmark1 = (Date.now() + 5000)
        await search.addPage({
            pageDoc: testData.PAGE_DOC_1,
            bookmarkDocs: [],
            visits: [visit1],
        })
        await search.addTag(testData.PAGE_DOC_1.url, 'virus')
        await search.addTag(testData.PAGE_DOC_1.url, 'fix')
        await search.addBookmark({ url: testData.PAGE_DOC_1.url, timestamp: bookmark1, tabId: 25 })

        const stream = exportOldPages()
        const exported = []
        await new Promise((resolve, reject) => {
            stream
                .on('data', (obj) => {
                    exported.push(obj)
                })
                .on('error', reject)
                .on('end', resolve)
        })
        expect(exported).toEqual([{
            url: "https://www.2-spyware.com/remove-skype-virus.html",
            content: {
                lang: testData.PAGE_DOC_1.content.lang,
                title: testData.PAGE_DOC_1.content.title,
                fullText: testData.PAGE_DOC_1.content.fullText,
                keywords: testData.PAGE_DOC_1.content.keywords,
                description: testData.PAGE_DOC_1.content.description
            },
            visits: [{ timestamp: visit1 }],
            tags: ['virus', 'fix'],
            bookmark: bookmark1
        }])
    })
})

describe('New search index', () => {
    test('Integration test', async () => {
        search.getBackend._reset({ useOld: false })
        newIndex.init({
            indexedDB: fakeIDBFactory,
            IDBKeyRange: fakeIDBKeyRange,
            dbName: 'dexie',
        })
        await doIntegrationTest()
    })

    test('Importing data', async () => {
        search.getBackend._reset({ useOld: false })
        newIndex.init({
            indexedDB: fakeIDBFactory,
            IDBKeyRange: fakeIDBKeyRange,
            dbName: 'dexie',
        })
        await importNewPage({
            url: 'https://www.test.com?q=test',
            content: {
                title: 'very interesting futile title',
                fullText: 'body text with some useless filling stuff',
            },
            visits: [],
            tags: [],
            bookmark: null
        })
        const { docs: results } = await search.search({
            query: 'interesting',
            mapResultsFunc: async results => results,
        })
        expect(results).toEqual([
            expect.objectContaining({
                url: 'https://www.test.com?q=test',
                title: 'very interesting futile title'
            })
        ])
    })
})
