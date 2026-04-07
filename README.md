# SoundVault

## Project Description: 
SoundVault is a web-based music player inspired by offline, local music players such as Foobar2000, Strawberry, and AIMP. It allows authenticated users to browse a curated music library, stream tracks securely via a server-side proxy, create and manage personal playlists, and discover music through album art and metadata pulled from the MusicBrainz API. A local Express API serves as the music catalog and streaming backend, while all audio files are stored in cloud storage and are never directly exposed to the browser.

User Stories:
As a user, I can sign up for an account and log in securely so my playlists and preferences are saved.

As a user, I can browse the music library by artist, album, or genre and see album art and metadata.

As a user, I can stream songs directly in my browser with play/pause, skip, volume, and seek controls.

As a user, I can create, rename, and delete playlists, and add or remove songs from them.

As a user, I can search the library by song title, artist, or album and get instant results.

As a user, I can edit my profile (display name, email, preferred genre) and see those changes reflected.

As a visitor, I cannot access audio files directly, streaming is only available to authenticated users via the server-side proxy.

Brandon will focus on the  Express routes, server-side proxy streaming, Cloudflare R2 integration, session auth, MusicBrainz integration, database implementation, and music file backend (music API data, encoding) to be able to produce music output on the website securely.

### Specific files that are being worked on by Brandon:
```
 server.js
 routes/songs.js
 routes/auth.js
```

Maeva will handle the user profile pages and playlist management interface. This includes building the profile edit form (display name, email,...) with pre-filled fields that update the database via UPDATE SQL, the playlist creation/rename/delete, and the add/remove songs from playlist functionality. She will implement client-side JavaScript (Fetch API calls to the local Express routes) to interact with the backend, and handle session-based display of the logged-in user's data on the profile page. She will also contribute to the overall CSS styling for consistency across these pages.

Matthew will handle the music control interface, allowing users to stop, play, skip, or play songs at specific times, as well as changing the volume and allowing users to interact with premade playlists while listening to songs. 

Dalia Cabrera Hurtado: will be responsible for the music library browse pages, where users can explore music by artist, album, and genre with album art and metadata from the MusicBrainz API. I will also build the search feature so users can quickly find songs, artists, or albums. On top of that, I will create the home page and take charge of the overall CSS and site design to keep everything looking consistent across all pages.

Description of *current* data tables: 
```
users:
    user_id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    display_name VARCHAR(50) NOT NULL,
    favorite_genre VARCHAR(30) DEFAULT 'All',
    show_recent TINYINT(1) DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP

songs:
    id INT AUTO_INCREMENT PRIMARY KEY,
    length INT DEFAULT 0,
    title VARCHAR(150) NOT NULL,
    artist VARCHAR(100) NOT NULL,
    album VARCHAR(100) DEFAULT NULL,
    genre VARCHAR(30) DEFAULT 'Other',
    cloud_key VARCHAR(255) NOT NULL, 
    mb_release_id VARCHAR(36) DEFAULT NULL,
    INDEX idx_artist (artist),
    INDEX idx_genre  (genre),
    FULLTEXT idx_search (title, artist, album)

playlists:
    playlist_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT fk_playlist_user
        FOREIGN KEY (user_id) REFERENCES users(user_id)
        ON DELETE CASCADE

playlist_songs:
    id  INT AUTO_INCREMENT PRIMARY KEY,
    playlist_id INT NOT NULL,
    song_id INT NOT NULL,
    position INT NOT NULL DEFAULT 0,
    added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_playlist_song (playlist_id, song_id),
    CONSTRAINT fk_ps_playlist
    FOREIGN KEY (playlist_id) REFERENCES playlists(playlist_id)
        ON DELETE CASCADE,
    CONSTRAINT fk_ps_song
        FOREIGN KEY (song_id) REFERENCES songs(song_id)
        ON DELETE CASCADE
```
Timeline: 
Friday, April 16:
Express routes and views are complete.
Database and cloud are ready.
API choices are complete.
Basic login is complete

Friday, April 21:
Design for webpages completed (using css or bootstrap)
Login functionality complete, user can now create account and have info saved.
Successfully test song security and playback capabilities 
Start building search functionality
Basic music playback functionality complete.

Friday, April 28:
Users can now create and save playlists, users can also like other user playlists.
Music metadata is fetched from API to show proper album covers and lyrics.
Begin to add dynamic features to overall design.
Begin security checks to for server (music fetching) 

Friday, May 5:
Complete web page design
Ensure quality - Test for errors and resolve issues.


API’s Used: 
https://musicbrainz.org/doc/MusicBrainz_API

