
// Firebase Configuration
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT_ID.appspot.com",
    messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
    appId: "YOUR_APP_ID"
};

let firebase = null;
let db = null;
let storage = null;
let isFirebaseConfigured = false;

// Initialize Firebase if configured
if (firebaseConfig.apiKey !== 'YOUR_API_KEY') {
    try {
        firebase.initializeApp(firebaseConfig);
        db = firebase.firestore();
        storage = firebase.storage();
        isFirebaseConfigured = true;
    } catch (error) {
        console.warn('Failed to initialize Firebase:', error);
    }
}

class MusicPlayer {
    constructor() {
        this.audio = document.getElementById('audioPlayer');
        this.playPauseBtn = document.getElementById('playPauseBtn');
        this.prevBtn = document.getElementById('prevBtn');
        this.nextBtn = document.getElementById('nextBtn');
        this.progressBar = document.querySelector('.progress-bar');
        this.progress = document.getElementById('progress');
        this.progressHandle = document.getElementById('progressHandle');
        this.currentTimeEl = document.getElementById('currentTime');
        this.durationEl = document.getElementById('duration');
        this.volumeSlider = document.getElementById('volumeSlider');
        this.trackTitle = document.getElementById('trackTitle');
        this.trackArtist = document.getElementById('trackArtist');
        this.albumArt = document.getElementById('albumArt');
        this.audioUpload = document.getElementById('audioUpload');
        this.playlistContainer = document.querySelector('.playlist-container');
        this.repeatBtn = document.getElementById('repeatBtn');
        this.firebaseStatus = document.getElementById('firebaseStatus');

        this.playlist = [];
        this.currentTrackIndex = 0;
        this.isPlaying = false;
        this.isDragging = false;
        this.lastProgressUpdate = 0;
        this.isRepeatAll = true;

        this.init();
    }

    async init() {
        this.updateFirebaseStatus();
        await this.loadSavedPlaylist();
        if (isFirebaseConfigured) {
            await this.loadFirebaseSongs();
        }
        this.setupEventListeners();
        this.setVolume(50);
        this.autoFetchDeviceSongs();

        if (this.playlist.length > 0) {
            this.loadTrack(0);
        } else {
            this.trackTitle.textContent = 'No songs in playlist';
            this.trackArtist.textContent = 'Add music to get started';
            this.albumArt.src = 'https://via.placeholder.com/200x200/000000/ffffff?text=♪';
            
            // Auto-trigger notification
            setTimeout(() => {
                const message = isFirebaseConfigured 
                    ? 'Add music files or sync from your cloud library!'
                    : 'Add music files or configure Firebase to sync your library!';
                this.showNotification(message);
            }, 1500);
        }

        this.updatePlaylistDisplay();
    }

    updateFirebaseStatus() {
        if (isFirebaseConfigured) {
            this.firebaseStatus.className = 'firebase-status connected';
            this.firebaseStatus.innerHTML = '<p>✅ Firebase connected - Your music syncs to the cloud!</p>';
        } else {
            this.firebaseStatus.className = 'firebase-status';
            this.firebaseStatus.innerHTML = '<p>⚠️ Configure Firebase in script.js to sync your music library</p>';
        }
    }

    async loadFirebaseSongs() {
        if (!isFirebaseConfigured) return;

        try {
            const snapshot = await db.collection('songs').orderBy('createdAt', 'desc').get();
            
            snapshot.forEach(doc => {
                const song = doc.data();
                const exists = this.playlist.some(track => track.firebaseId === doc.id);
                if (!exists && song.fileUrl) {
                    const track = {
                        id: this.generateTrackId(),
                        firebaseId: doc.id,
                        title: song.title,
                        artist: song.artist || 'Unknown Artist',
                        src: song.fileUrl,
                        albumArt: song.albumArt || 'https://via.placeholder.com/200x200/333333/ffffff?text=♪',
                        saved: true,
                        synced: true,
                        cloudSync: true
                    };
                    this.playlist.push(track);
                }
            });

        } catch (error) {
            console.error('Error loading Firebase songs:', error);
        }
    }

    async syncTrackToFirebase(track) {
        if (!isFirebaseConfigured || track.synced) return;

        try {
            const docRef = await db.collection('songs').add({
                title: track.title,
                artist: track.artist,
                albumArt: track.albumArt,
                fileSize: 0, // We don't have file size for local files
                syncedFromLocal: true,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            track.firebaseId = docRef.id;
            track.synced = true;
            this.savePlaylist();
            this.updatePlaylistDisplay();
            this.showNotification(`"${track.title}" synced to cloud!`);
            return true;

        } catch (error) {
            console.error('Error syncing track to Firebase:', error);
            this.showNotification(`Failed to sync "${track.title}" to cloud`);
            return false;
        }
    }

    async syncAllToFirebase() {
        if (!isFirebaseConfigured) {
            this.showNotification('Configure Firebase to enable cloud sync');
            return;
        }

        const unsyncedTracks = this.playlist.filter(track => !track.synced && !track.cloudSync);
        if (unsyncedTracks.length === 0) {
            this.showNotification('All tracks are already synced to cloud!');
            return;
        }

        this.showNotification(`Syncing ${unsyncedTracks.length} tracks to cloud...`);
        
        let successCount = 0;
        for (const track of unsyncedTracks) {
            const success = await this.syncTrackToFirebase(track);
            if (success) successCount++;
        }

        this.showNotification(`Successfully synced ${successCount}/${unsyncedTracks.length} tracks to cloud!`);
    }

    savePlaylist() {
        try {
            const playlistData = this.playlist.map(track => ({
                id: track.id,
                firebaseId: track.firebaseId,
                title: track.title,
                artist: track.artist,
                albumArt: track.albumArt,
                saved: track.saved || false,
                synced: track.synced || false,
                cloudSync: track.cloudSync || false,
                autoFetched: track.autoFetched || false,
                src: track.src.startsWith('blob:') ? null : track.src
            }));
            localStorage.setItem('musicPlayerPlaylist', JSON.stringify(playlistData));
            localStorage.setItem('musicPlayerCurrentIndex', this.currentTrackIndex.toString());
        } catch (error) {
            console.warn('Could not save playlist:', error);
        }
    }

    async loadSavedPlaylist() {
        this.playlist = [];
        
        try {
            const savedPlaylist = localStorage.getItem('musicPlayerPlaylist');
            const savedIndex = localStorage.getItem('musicPlayerCurrentIndex');

            if (savedPlaylist) {
                const parsedPlaylist = JSON.parse(savedPlaylist);
                const validTracks = parsedPlaylist.filter(track => track.src !== null);
                
                this.playlist = validTracks;

                if (savedIndex && parseInt(savedIndex) < this.playlist.length) {
                    this.currentTrackIndex = parseInt(savedIndex);
                }
            }
        } catch (error) {
            console.warn('Could not load saved playlist:', error);
        }
    }

    generateTrackId() {
        return 'track-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    }

    setupEventListeners() {
        this.playPauseBtn.addEventListener('click', () => this.togglePlayPause());
        this.prevBtn.addEventListener('click', () => this.previousTrack());
        this.nextBtn.addEventListener('click', () => this.nextTrack());

        this.progressBar.addEventListener('click', (e) => this.seekTo(e));
        this.progressHandle.addEventListener('mousedown', (e) => this.startDragging(e));
        this.progressBar.addEventListener('mousedown', (e) => this.startDragging(e));
        document.addEventListener('mousemove', (e) => this.dragProgress(e));
        document.addEventListener('mouseup', () => this.stopDragging());
        
        this.progressHandle.addEventListener('touchstart', (e) => this.startDragging(e));
        this.progressBar.addEventListener('touchstart', (e) => this.startDragging(e));
        document.addEventListener('touchmove', (e) => this.dragProgress(e));
        document.addEventListener('touchend', () => this.stopDragging());

        this.volumeSlider.addEventListener('input', (e) => this.setVolume(e.target.value));

        this.audio.addEventListener('loadedmetadata', () => this.updateDuration());
        this.audio.addEventListener('timeupdate', this.throttle(() => this.updateProgress(), 100));
        this.audio.addEventListener('ended', () => this.nextTrack());
        this.audio.addEventListener('loadstart', () => this.resetProgress());
        this.audio.addEventListener('error', (e) => this.handleAudioError(e));

        this.audioUpload.addEventListener('change', (e) => this.handleFileUpload(e));
        document.addEventListener('keydown', (e) => this.handleKeyPress(e));
        this.playlistContainer.addEventListener('click', (e) => this.handlePlaylistClick(e));
        this.repeatBtn.addEventListener('click', () => this.toggleRepeat());
    }

    togglePlayPause() {
        if (this.playlist.length === 0) {
            this.showNotification('No songs in playlist. Please add music.');
            return;
        }

        if (this.isPlaying) {
            this.pause();
        } else {
            this.play();
        }
    }

    async play() {
        try {
            await this.audio.play();
            this.isPlaying = true;
            this.playPauseBtn.innerHTML = '<i class="fas fa-pause"></i>';
            document.body.classList.add('playing');
        } catch (error) {
            console.warn('Playback failed:', error);
            this.isPlaying = false;
            this.playPauseBtn.innerHTML = '<i class="fas fa-play"></i>';
            document.body.classList.remove('playing');
        }
    }

    pause() {
        this.audio.pause();
        this.isPlaying = false;
        this.playPauseBtn.innerHTML = '<i class="fas fa-play"></i>';
        document.body.classList.remove('playing');
    }

    previousTrack() {
        if (this.playlist.length === 0) {
            this.showNotification('No songs in playlist. Please add music.');
            return;
        }

        this.currentTrackIndex = this.currentTrackIndex === 0 
            ? this.playlist.length - 1 
            : this.currentTrackIndex - 1;

        this.loadTrack(this.currentTrackIndex);
        if (this.isPlaying) this.play();
    }

    nextTrack() {
        if (this.playlist.length === 0) {
            this.showNotification('No songs in playlist. Please add music.');
            return;
        }

        const wasPlaying = this.isPlaying;

        if (this.isRepeatAll) {
          this.currentTrackIndex = (this.currentTrackIndex + 1) % this.playlist.length;
        } else {
          if (this.currentTrackIndex < this.playlist.length - 1) {
            this.currentTrackIndex++;
          } else {
            this.pause();
            return;
          }
        }

        this.loadTrack(this.currentTrackIndex);
        
        if (wasPlaying) {
            setTimeout(() => {
                this.play();
            }, 100);
        }
    }

    toggleRepeat() {
        this.isRepeatAll = !this.isRepeatAll;
        if (this.isRepeatAll) {
            this.repeatBtn.classList.add('active');
            this.repeatBtn.title = 'Repeat All';
        } else {
            this.repeatBtn.classList.remove('active');
            this.repeatBtn.title = 'Repeat Off';
        }
    }

    loadTrack(index) {
        if (!this.playlist[index] || this.playlist.length === 0) {
            this.pause();
            this.audio.src = '';
            this.audio.load();
            this.resetProgress();
            this.trackTitle.textContent = 'No songs in playlist';
            this.trackArtist.textContent = 'Add music to get started';
            this.albumArt.src = 'https://via.placeholder.com/200x200/000000/ffffff?text=♪';
            this.currentTrackIndex = 0;
            this.updatePlaylistDisplay();
            return;
        }

        const track = this.playlist[index];

        try {
            this.pause();
            this.resetProgress();

            if (!track.src || track.src === '') {
                throw new Error('Invalid track source');
            }

            this.audio.src = track.src;
            this.trackTitle.textContent = track.title || 'Unknown Title';
            this.trackArtist.textContent = track.artist || 'Unknown Artist';
            this.albumArt.src = track.albumArt || 'https://via.placeholder.com/200x200/000000/ffffff?text=♪';

            this.currentTrackIndex = index;
            this.updatePlaylistDisplay();
            this.savePlaylist();
        } catch (error) {
            console.warn('Failed to load track:', track.title, error);
            this.trackTitle.textContent = 'Error loading track';
            this.trackArtist.textContent = 'Please try another file';
            this.audio.src = '';
            this.audio.load();
        }
    }

    seekTo(e) {
        if (!this.audio.duration) return;

        const rect = this.progressBar.getBoundingClientRect();
        const percent = (e.clientX - rect.left) / rect.width;
        const time = percent * this.audio.duration;

        this.audio.currentTime = time;
        this.updateProgress();
    }

    startDragging(e) {
        this.isDragging = true;
        e.preventDefault();
        this.dragProgress(e);
    }

    dragProgress(e) {
        if (!this.isDragging || !this.audio.duration) return;

        const rect = this.progressBar.getBoundingClientRect();
        let clientX;
        
        if (e.touches) {
            clientX = e.touches[0].clientX;
        } else {
            clientX = e.clientX;
        }
        
        const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        const time = percent * this.audio.duration;

        this.progress.style.width = `${percent * 100}%`;
        this.progressHandle.style.left = `${percent * 100}%`;
        this.currentTimeEl.textContent = this.formatTime(time);
        
        this.audio.currentTime = time;
    }

    stopDragging() {
        this.isDragging = false;
    }

    updateProgress() {
        if (this.isDragging) return;

        const currentTime = this.audio.currentTime || 0;
        const duration = this.audio.duration || 0;

        if (duration && !isNaN(currentTime) && !isNaN(duration)) {
            const percent = Math.min(100, Math.max(0, (currentTime / duration) * 100));
            
            requestAnimationFrame(() => {
                this.progress.style.width = `${percent}%`;
                this.progressHandle.style.left = `${percent}%`;
            });
        }

        this.currentTimeEl.textContent = this.formatTime(currentTime);
    }

    updateDuration() {
        this.durationEl.textContent = this.formatTime(this.audio.duration);
    }

    resetProgress() {
        this.progress.style.width = '0%';
        this.progressHandle.style.left = '0%';
        this.currentTimeEl.textContent = '0:00';
        this.durationEl.textContent = '0:00';
    }

    setVolume(value) {
        this.audio.volume = value / 100;
        this.volumeSlider.value = value;
    }

    formatTime(seconds) {
        if (isNaN(seconds)) return '0:00';

        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    handleFileUpload(e) {
        const files = Array.from(e.target.files);

        files.forEach(file => {
            if (file.type.startsWith('audio/') && file.size < 50 * 1024 * 1024) {
                try {
                    const url = URL.createObjectURL(file);
                    const track = {
                        id: this.generateTrackId(),
                        title: file.name.replace(/\.[^/.]+$/, ""),
                        artist: 'Unknown Artist',
                        src: url,
                        albumArt: 'https://via.placeholder.com/200x200/333333/ffffff?text=♪',
                        saved: false,
                        synced: false,
                        cloudSync: false
                    };

                    this.playlist.push(track);

                    if (this.playlist.length === 1) {
                        this.loadTrack(0);
                    }
                } catch (error) {
                    console.warn('Failed to load file:', file.name, error);
                }
            } else if (file.size >= 50 * 1024 * 1024) {
                alert(`File "${file.name}" is too large. Maximum size is 50MB.`);
            }
        });

        this.updatePlaylistDisplay();
        this.savePlaylist();
        e.target.value = '';
    }

    async autoFetchDeviceSongs() {
        try {
            if ('showDirectoryPicker' in window) {
                const autoFetchBtn = document.createElement('button');
                autoFetchBtn.className = 'auto-fetch-btn';
                autoFetchBtn.innerHTML = '<i class="fas fa-folder-open"></i> Auto-fetch Device Songs';
                autoFetchBtn.title = 'Automatically scan and load songs from a folder';
                
                const uploadSection = this.playlistContainer.querySelector('.upload-section');
                uploadSection.appendChild(autoFetchBtn);

                autoFetchBtn.addEventListener('click', async () => {
                    await this.scanDeviceForSongs();
                });

                // Add sync all button if Firebase is configured
                if (isFirebaseConfigured) {
                    const syncAllBtn = document.createElement('button');
                    syncAllBtn.className = 'sync-all-btn';
                    syncAllBtn.innerHTML = '<i class="fas fa-cloud-upload-alt"></i> Sync All to Cloud';
                    syncAllBtn.title = 'Sync all local tracks to Firebase cloud storage';
                    
                    uploadSection.appendChild(syncAllBtn);

                    syncAllBtn.addEventListener('click', async () => {
                        await this.syncAllToFirebase();
                    });
                }
            }
        } catch (error) {
            console.warn('Auto-fetch not supported on this browser:', error);
        }
    }

    async scanDeviceForSongs() {
        try {
            const directoryHandle = await window.showDirectoryPicker({
                mode: 'read'
            });

            const audioFiles = [];
            await this.scanDirectory(directoryHandle, audioFiles);

            if (audioFiles.length > 0) {
                let loadedCount = 0;
                for (const fileHandle of audioFiles) {
                    try {
                        const file = await fileHandle.getFile();
                        if (file.type.startsWith('audio/') && file.size < 50 * 1024 * 1024) {
                            const url = URL.createObjectURL(file);
                            const track = {
                                id: this.generateTrackId(),
                                title: file.name.replace(/\.[^/.]+$/, ""),
                                artist: 'Unknown Artist',
                                src: url,
                                albumArt: 'https://via.placeholder.com/200x200/333333/ffffff?text=♪',
                                saved: false,
                                synced: false,
                                cloudSync: false,
                                autoFetched: true
                            };

                            const exists = this.playlist.some(existingTrack => 
                                existingTrack.title === track.title
                            );

                            if (!exists) {
                                this.playlist.push(track);
                                loadedCount++;
                            }
                        }
                    } catch (fileError) {
                        console.warn('Failed to load file:', fileHandle.name, fileError);
                    }
                }

                if (loadedCount > 0) {
                    this.updatePlaylistDisplay();
                    this.savePlaylist();
                    
                    if (this.playlist.length === loadedCount) {
                        this.loadTrack(0);
                    }

                    this.showNotification(`Successfully loaded ${loadedCount} songs from device!`);
                } else {
                    this.showNotification('No new audio files found in the selected folder.');
                }
            } else {
                this.showNotification('No audio files found in the selected folder.');
            }
        } catch (error) {
            if (error.name !== 'AbortError') {
                console.warn('Failed to scan device for songs:', error);
                this.showNotification('Failed to access device folder. Please try again.');
            }
        }
    }

    async scanDirectory(directoryHandle, audioFiles, maxDepth = 2, currentDepth = 0) {
        if (currentDepth >= maxDepth) return;

        try {
            for await (const entry of directoryHandle.values()) {
                if (entry.kind === 'file') {
                    const file = await entry.getFile();
                    if (file.type.startsWith('audio/')) {
                        audioFiles.push(entry);
                    }
                } else if (entry.kind === 'directory' && currentDepth < maxDepth - 1) {
                    await this.scanDirectory(entry, audioFiles, maxDepth, currentDepth + 1);
                }
            }
        } catch (error) {
            console.warn('Error scanning directory:', error);
        }
    }

    showNotification(message) {
        const notification = document.createElement('div');
        notification.className = 'notification';
        notification.textContent = message;
        document.body.appendChild(notification);

        setTimeout(() => {
            notification.classList.add('show');
        }, 100);

        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => {
                document.body.removeChild(notification);
            }, 300);
        }, 3000);
    }

    updatePlaylistDisplay() {
        const existingItems = this.playlistContainer.querySelectorAll('.playlist-item:not(.upload-section)');
        existingItems.forEach(item => item.remove());

        const uploadSection = this.playlistContainer.querySelector('.upload-section');

        this.playlist.forEach((track, index) => {
            const playlistItem = document.createElement('div');
            playlistItem.className = `playlist-item ${index === this.currentTrackIndex ? 'active' : ''}`;
            playlistItem.dataset.index = index;

            const autoFetchedIcon = track.autoFetched ? '<i class="fas fa-robot" title="Auto-fetched"></i>' : '';
            const cloudIcon = track.cloudSync ? '<i class="fas fa-cloud" title="From cloud"></i>' : '';

            playlistItem.innerHTML = `
                <i class="fas fa-music"></i>
                <div class="track-details">
                    <span class="track-name">${track.title} ${autoFetchedIcon}${cloudIcon}</span>
                    <span class="track-artist">${track.artist}</span>
                </div>
                <div class="track-controls">
                    <button class="save-btn ${track.saved ? 'saved' : ''}" data-index="${index}" title="${track.saved ? 'Saved' : 'Save track'}">
                        <i class="fas ${track.saved ? 'fa-heart' : 'fa-heart-o'}"></i>
                    </button>
                    ${isFirebaseConfigured && !track.cloudSync ? `
                    <button class="sync-btn ${track.synced ? 'synced' : ''}" data-index="${index}" title="${track.synced ? 'Synced to cloud' : 'Sync to cloud'}">
                        <i class="fas ${track.synced ? 'fa-cloud-upload-alt' : 'fa-cloud-upload-alt'}"></i>
                    </button>
                    ` : ''}
                    <button class="remove-btn" data-index="${index}" title="Remove track">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            `;

            this.playlistContainer.insertBefore(playlistItem, uploadSection);
        });
    }

    handlePlaylistClick(e) {
        if (e.target.closest('.save-btn')) {
            const index = parseInt(e.target.closest('.save-btn').dataset.index);
            this.toggleSaveTrack(index);
            return;
        }

        if (e.target.closest('.sync-btn')) {
            const index = parseInt(e.target.closest('.sync-btn').dataset.index);
            this.syncTrackToFirebase(this.playlist[index]);
            return;
        }

        if (e.target.closest('.remove-btn')) {
            const index = parseInt(e.target.closest('.remove-btn').dataset.index);
            this.removeTrack(index);
            return;
        }

        const playlistItem = e.target.closest('.playlist-item:not(.upload-section)');
        if (playlistItem) {
            const index = parseInt(playlistItem.dataset.index);
            if (index !== -1 && index < this.playlist.length) {
                this.currentTrackIndex = index;
                this.loadTrack(index);
                if (this.isPlaying) this.play();
            }
        }
    }

    toggleSaveTrack(index) {
        if (this.playlist[index]) {
            this.playlist[index].saved = !this.playlist[index].saved;
            this.updatePlaylistDisplay();
            this.savePlaylist();
        }
    }

    async removeTrack(index) {
        if (confirm('Are you sure you want to remove this track?')) {
            const track = this.playlist[index];
            
            // Revoke blob URL if it's a local file
            if (track.src.startsWith('blob:')) {
                URL.revokeObjectURL(track.src);
            }

            // Remove from Firebase if it's synced
            if (isFirebaseConfigured && track.firebaseId) {
                try {
                    await db.collection('songs').doc(track.firebaseId).delete();
                } catch (error) {
                    console.warn('Failed to remove track from Firebase:', error);
                }
            }

            this.playlist.splice(index, 1);

            // Handle empty playlist
            if (this.playlist.length === 0) {
                this.pause();
                this.audio.src = '';
                this.audio.load();
                this.resetProgress();
                this.currentTrackIndex = 0;
                this.loadTrack(0);
            } else {
                if (index === this.currentTrackIndex) {
                    if (index >= this.playlist.length) {
                        this.currentTrackIndex = this.playlist.length - 1;
                    }
                    this.loadTrack(this.currentTrackIndex);
                } else if (index < this.currentTrackIndex) {
                    this.currentTrackIndex--;
                }
            }

            this.updatePlaylistDisplay();
            this.savePlaylist();
        }
    }

    throttle(func, limit) {
        let inThrottle;
        return function() {
            const args = arguments;
            const context = this;
            if (!inThrottle) {
                func.apply(context, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        }
    }

    handleAudioError(e) {
        console.warn('Audio error:', e);
        this.trackTitle.textContent = 'Error playing audio';
        this.trackArtist.textContent = 'Please check the file format';
        this.isPlaying = false;
        this.playPauseBtn.innerHTML = '<i class="fas fa-play"></i>';
        document.body.classList.remove('playing');
    }

    handleKeyPress(e) {
        switch(e.code) {
            case 'Space':
                if (e.target === document.body) {
                    e.preventDefault();
                    this.togglePlayPause();
                }
                break;
            case 'ArrowLeft':
                if (e.ctrlKey) {
                    e.preventDefault();
                    this.previousTrack();
                }
                break;
            case 'ArrowRight':
                if (e.ctrlKey) {
                    e.preventDefault();
                    this.nextTrack();
                }
                break;
            case 'ArrowUp':
                if (e.ctrlKey) {
                    e.preventDefault();
                    const newVolume = Math.min(100, parseInt(this.volumeSlider.value) + 10);
                    this.setVolume(newVolume);
                }
                break;
            case 'ArrowDown':
                if (e.ctrlKey) {
                    e.preventDefault();
                    const newVolume = Math.max(0, parseInt(this.volumeSlider.value) - 10);
                    this.setVolume(newVolume);
                }
                break;
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new MusicPlayer();
});

// Display setup instructions if Firebase is not configured
if (!isFirebaseConfigured) {
    console.log(`
🎵 AYUSH'S Music Player - Firebase Setup Instructions:

1. Create a Firebase project at https://console.firebase.google.com
2. In your Firebase console:
   - Go to Project Settings (gear icon)
   - Scroll down to "Your apps" section
   - Click "Web" to add a web app
   - Copy the configuration object

3. Replace the firebaseConfig object in script.js with your configuration:
   const firebaseConfig = {
     apiKey: "your-api-key",
     authDomain: "your-project.firebaseapp.com",
     projectId: "your-project-id",
     storageBucket: "your-project.appspot.com",
     messagingSenderId: "123456789",
     appId: "your-app-id"
   };

4. Set up Firestore Database:
   - Go to Firestore Database
   - Create database in test mode (or production with security rules)
   - Create a collection called 'songs'

5. (Optional) Set up Firebase Storage:
   - Go to Storage
   - Get started and set up storage bucket
   - Configure security rules for file uploads

Your music will then sync to Firebase! 🎶
    `);
}
