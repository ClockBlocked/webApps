/**
 * 
 *  C R E A T E D  B Y
 * 
 *  William Hanson 
 * 
 *  Chevrolay@Outlook.com
 * 
 *  m.me/Chevrolay
 * 
 */
/**
 * 
    This script is responsible for storing videos THAT HAVE BEEN watched
    by You ( the user ), on Your device ( IndexDB -or- Local Storage ), with
    a video size limit of 500mb ( changeable ), & another very important 
    uodate regarding Storage capabilities coming very soon ( details below )**.
    
    This is for Your benefit, as well as My benefit;  Your save a small amount,
    for very mild users who watch very few videos, to a HUGE amount, for very dedicated 
    users who watch THE SAME VIDEOS SEVERAL TIMES ( this is important )***.
     
    You can opt out of this at any time, by changing your settings for JavaScript,
    located in your Browser Settings ( Mobile, PC, & iOS, Linux, ETC. ).
    
    For questions or comments:
    You can reach me at the email address listed above.above
    
  



     **
      an overall limit directly determined by the user's 
      device storage capacity & current usage, which will 
      require the user agreeing to such a feature explicitly
      via a official Prompt / ETC.
      
      will be adding within days from today (02.26.2026)



    ***
      the Play whenever, Forever™ feature ONLY APPLIES to videos that
      have been streamed / watched AT LEAST ONE TIME, in order for it
      to be Cached ( "saved" ), AKA stored in your device's "Local Storage";
      Thus, potentially saving the user a significant amount of money
      spent on his or her bill for his or her Internet usage or Mobile Data usage.
      Likewise, I benefit as well, due to less strain on the server, due
      to what would have been repeated server requests for literally the exact 
      same video file, & i am sure by now you get the picture.

 * 
 */
const DB_NAME = 'blobCache';
const DB_VERSION = 6;
const STORE_NAME = 'videos';
const MAX_STORAGE_MB = 500;

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = event => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, { keyPath: 'url' });
                store.createIndex('timestamp', 'timestamp');
                store.createIndex('size', 'size');
                store.createIndex('title', 'title');
            }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function getVideo(url) {
    try {
        const db = await openDB();
        return new Promise((resolve) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const req = store.get(url);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(null);
        });
    } catch (error) {
        console.log('Error getting video:', error);
        return null;
    }
}

async function saveVideo(url, blob, meta = {}) {
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);

            const entry = {
                url,
                blob,
                size: blob.size,
                timestamp: Date.now(),
                title: meta.title || url.split('/').pop() || 'Untitled Video',
                duration: meta.duration || 0,
                contentType: meta.contentType || blob.type,
                complete: true // Mark as complete video
            };

            const request = store.put(entry);
            
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
            
            tx.oncomplete = () => {
                // Enforce quota after successful save
                enforceQuota(db).catch(console.log);
                resolve();
            };
        });
    } catch (error) {
        console.log('Error saving video:', error);
    }
}

async function enforceQuota(db) {
    try {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.getAll();

        const items = await new Promise(resolve => {
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => resolve([]);
        });

        const totalBytes = items.reduce((sum, item) => sum + (item.size || 0), 0);
        const maxBytes = MAX_STORAGE_MB * 1024 * 1024;

        if (totalBytes <= maxBytes) return;

        // Sort by timestamp (oldest first)
        items.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

        let bytes = totalBytes;
        const deleteTx = db.transaction(STORE_NAME, 'readwrite');
        const deleteStore = deleteTx.objectStore(STORE_NAME);

        for (let item of items) {
            if (bytes <= maxBytes) break;
            deleteStore.delete(item.url);
            bytes -= (item.size || 0);
        }
    } catch (error) {
        console.log('Error enforcing quota:', error);
    }
}

async function streamAndCache(request) {
    // First, fetch the video from network
    const response = await fetch(request);
    
    if (!response.ok) return response;
    
    // Check if it's a video
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('video')) {
        return response;
    }

    // IMPORTANT: Clone the response for caching
    // The original response goes to the browser for immediate playback
    const responseForCache = response.clone();
    
    // Get the content length if available
    const contentLength = response.headers.get('content-length');
    
    // Start caching in the background WITHOUT blocking playback
    (async () => {
        try {
            console.log('📥 Starting background cache of:', request.url.split('/').pop());
            
            // Read the entire stream and collect all chunks
            const reader = responseForCache.body.getReader();
            const chunks = [];
            let totalBytes = 0;
            
            // Read all chunks from the stream
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                chunks.push(value);
                totalBytes += value.length;
                
                // Optional: Log progress for large files
                if (contentLength) {
                    const percent = Math.round((totalBytes / parseInt(contentLength)) * 100);
                    if (percent % 25 === 0) { // Log at 25%, 50%, 75%, 100%
                        console.log(`⏳ Caching progress: ${percent}%`);
                    }
                }
            }
            
            // Combine all chunks into a single Blob
            const blob = new Blob(chunks, { type: contentType });
            
            // Save the complete video to IndexedDB
            await saveVideo(request.url, blob, {
                title: request.url.split('/').pop(),
                contentType: contentType
            });
            
            console.log('✅ Video fully cached:', request.url.split('/').pop());
        } catch (cacheError) {
            console.log('Background caching failed:', cacheError.message);
        }
    })(); // Don't await - let it run in background
    
    // Return the original response immediately for playback
    return response;
}

async function handleRangeRequest(request, cached) {
    try {
        const range = request.headers.get('Range');
        
        // If no range requested or blob is missing, return full video
        if (!range || !cached.blob) {
            return new Response(cached.blob, {
                status: 200,
                headers: {
                    'Content-Type': cached.blob.type,
                    'Content-Length': cached.blob.size,
                    'Accept-Ranges': 'bytes'
                }
            });
        }

        // Parse range header
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : cached.blob.size - 1;

        // Ensure valid range
        if (start >= cached.blob.size || end >= cached.blob.size) {
            return new Response(null, {
                status: 416,
                statusText: 'Range Not Satisfiable',
                headers: {
                    'Content-Range': `bytes */${cached.blob.size}`
                }
            });
        }

        const sliced = cached.blob.slice(start, end + 1);

        return new Response(sliced, {
            status: 206,
            statusText: 'Partial Content',
            headers: {
                'Content-Range': `bytes ${start}-${end}/${cached.blob.size}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': sliced.size,
                'Content-Type': cached.blob.type
            }
        });
    } catch (error) {
        console.log('Error handling range request:', error);
        // Fall back to full video
        return new Response(cached.blob);
    }
}

// Single fetch handler
self.addEventListener('fetch', event => {
    const request = event.request;

    // Only handle GET requests
    if (request.method !== 'GET') return;

    // Check if it's a video request
    const isVideo = 
        request.destination === 'video' ||
        (request.headers.get('accept') && request.headers.get('accept').includes('video')) ||
        request.url.match(/\.(mp4|webm|ogg|m3u8|mov|mkv|avi)$/i);

    if (!isVideo) return;

    event.respondWith((async () => {
        try {
            // Check if we have this video cached
            const cached = await getVideo(request.url);
            
            if (cached && cached.blob && cached.complete) {
                console.log('🎬 Serving from cache:', request.url.split('/').pop());
                return handleRangeRequest(request, cached);
            }
            
            // Not in cache (or incomplete), stream from network and cache in background
            console.log('🌐 Streaming from network (background caching):', request.url.split('/').pop());
            return streamAndCache(request);
            
        } catch (error) {
            console.log('Error in fetch handler, falling back to network:', error);
            return fetch(request);
        }
    })());
});

// Install and activate
self.addEventListener('install', event => {
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil(self.clients.claim());
});

// Handle messages from the page
self.addEventListener('message', event => {
    if (event.data && event.data.type === 'GET_CACHE_STATUS') {
        event.ports[0].postMessage({ status: 'active' });
    }
});