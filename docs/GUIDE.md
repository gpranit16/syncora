# NexusHub - User Guide

Welcome to NexusHub, your premium Smart Team Collaboration platform. This guide outlines how to use the application effectively.

## 1. Getting Started
When you first log in, you will be prompted to either **Create a New Workspace** or **Join an Existing Workspace**.
* **Create**: Provide a name and optional description to become the owner of a new workspace.
* **Join**: A list of available public workspaces will be shown. Click "Join" to enter an existing one.

## 2. Navigating the App
The **Sidebar** on the left is your main navigation hub. On mobile devices, this is hidden by default and accessible via the **Menu** button in the top left.
* **Workspace Dropdown**: Click the workspace name at the top of the sidebar to switch between different workspaces you belong to. If you are an owner, you can also **Invite Members** by typing their email address here.
* **Channels**: Dedicated spaces for specific topics. Click the `+` icon to create a new channel. 
* **Direct Messages**: Click "Messages" to open the 1-on-1 private messaging interface. You can search for users to start a conversation.
* **Tasks**: A Kanban-style task board. Create tasks, set priorities, and drag them between "Pending", "In Progress", and "Completed".

## 3. Using Chat
* **Sending Messages**: Type your message in the input bar at the bottom and press `Enter` or click the `Send` icon.
* **Editing/Deleting**: Hover over your own messages to reveal options to Edit (pen icon) or Delete (trash icon).
* **Replying**: Click the Reply (arrow icon) on any message to start a reply thread.
* **Real-time Indication**: You'll see "typing..." indicators when others are writing, and the chat auto-scrolls to the latest message.

## 4. Global Search & Notifications
* **Search**: Click the search bar at the top (or press `Cmd/Ctrl + K`) to search for users, messages, or channels globally.
* **Notifications**: Click the Bell icon in the top right to see your recent notifications, unread counts, and alerts for new tasks or mentions.

## 5. Troubleshooting
* **Cannot Send Messages?** Make sure the backend server (`npm run dev` in the backend folder) is running, as real-time messaging requires an active Socket.io connection.
* **Typing Bar Cut Off?** Ensure your browser viewport is normal; the app uses `100dvh` to handle mobile browser toolbars natively.

Enjoy your command center!
