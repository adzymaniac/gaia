/*global define, navigator */
define(function(require) {

var templateNode = require('tmpl!./folder_picker.html'),
    fldFolderItemNode = require('tmpl!./fld/folder_item.html'),
    FOLDER_DEPTH_CLASSES = require('folder_depth_classes'),
    common = require('mail_common'),
    MailAPI = require('api'),
    mozL10n = require('l10n!'),
    Cards = common.Cards,
    bindContainerHandler = common.bindContainerHandler;

require('css!style/folder_cards');

function FolderPickerCard(domNode, mode, args) {
  this.domNode = domNode;

  this.foldersSlice = args.foldersSlice;
  this.foldersSlice.onsplice = this.onFoldersSplice.bind(this);
  this.foldersSlice.onchange = this.onFoldersChange.bind(this);

  this.curAccount = args.curAccount;
  this.curFolder = args.curFolder;
  this.mostRecentSyncTimestamp = 0;

  this.acctsSlice = args.acctsSlice;

  this.foldersContainer =
    domNode.getElementsByClassName('fld-folders-container')[0];
  bindContainerHandler(this.foldersContainer, 'click',
                       this.onClickFolder.bind(this));

  this.accountButton = domNode.getElementsByClassName('fld-accounts-btn')[0];
  this.accountButton
    .addEventListener('click', this.onShowAccounts.bind(this), false);
  domNode.getElementsByClassName('fld-nav-settings-btn')[0]
    .addEventListener('click', this.onShowSettings.bind(this), false);

  this.toolbarAccountProblemNode =
    domNode.getElementsByClassName('fld-nav-account-problem')[0];
  this.lastSyncedAtNode =
    domNode.getElementsByClassName('fld-nav-last-synced-value')[0];

  // - DOM!
  this.updateSelfDom();
  // since the slice is already populated, generate a fake notification
  this.onFoldersSplice(0, 0, this.foldersSlice.items, true, false);
}
FolderPickerCard.prototype = {
  nextCards: ['settings_main', 'account_picker'],

  onShowSettings: function() {
    Cards.pushCard(
      'settings_main', 'default', 'animate', {}, 'left');
  },

  /**
   * Clicking a different account changes the list of folders displayed.  We
   * then trigger a select of the inbox for that account because otherwise
   * things get permutationally complex.
   */
  updateAccount: function(account) {
    var oldAccount = this.curAccount;

    this.mostRecentSyncTimestamp = 0;

    if (oldAccount !== account) {
      this.curAccount = account;

      // update header
      this.domNode.getElementsByClassName('fld-folders-header-account-label')[0]
        .textContent = account.name;

      // kill the old slice and its related DOM
      this.foldersSlice.die();
      this.foldersContainer.innerHTML = '';
      this.lastSyncedAtNode.textContent = '';
      this.lastSyncedAtNode.removeAttribute('data-time');

      // stop the user from doing anything until we load the folders for the
      // account and then transition to our card.
      Cards.eatEventsUntilNextCard();

      // load the folders for the account
      this.foldersSlice = MailAPI.viewFolders('account', account);
      this.foldersSlice.onsplice = this.onFoldersSplice.bind(this);
      this.foldersSlice.onchange = this.onFoldersChange.bind(this);
      // This will cause the splice handler to select the inbox for us; we do
      // this in the splice handler rather than in oncomplete because the splice
      // handler happens first and creates the DOM, and so this way it will set
      // the selection to be reflected in the DOM from the get-go.
      this.curFolder = null;
    }
  },
  onShowAccounts: function() {
    // Add account picker before this folder list.
    Cards.pushCard(
      'account_picker', 'navigation', 'animate',
      {
        acctsSlice: this.acctsSlice,
        curAccount: this.curAccount
      },
      // Place to left of message list
      'left');
  },

  onFoldersSplice: function(index, howMany, addedItems,
                             requested, moreExpected) {
    // automatically select the inbox if this is an oncomplete case and we have
    // no selected folder.
    if (!this.curFolder && !moreExpected) {
      // Now that we can populate ourselves, move to us.
      Cards.moveToCard(this);

      // Also, get the folder card started because of the tray visibility issue.
      this.curFolder = this.foldersSlice.getFirstFolderWithType('inbox',
                                                                addedItems);
      this._showFolder(this.curFolder);
    }

    var foldersContainer = this.foldersContainer;

    var folder;
    if (howMany) {
      for (var i = index + howMany - 1; i >= index; i--) {
        folder = this.foldersSlice.items[i];
        foldersContainer.removeChild(folder.element);
      }
    }

    var dirtySyncTime = false;
    var insertBuddy = (index >= foldersContainer.childElementCount) ?
                        null : foldersContainer.children[index],
        self = this;
    addedItems.forEach(function(folder) {
      var folderNode = folder.element = fldFolderItemNode.cloneNode(true);
      folderNode.folder = folder;
      self.updateFolderDom(folder, true);
      foldersContainer.insertBefore(folderNode, insertBuddy);

      if (self.mostRecentSyncTimestamp < folder.lastSyncedAt) {
        self.mostRecentSyncTimestamp = folder.lastSyncedAt;
        dirtySyncTime = true;
      }
    });
    if (dirtySyncTime)
      this.updateLastSyncedUI();
  },

  onFoldersChange: function(folder) {
    if (this.mostRecentSyncTimestamp < folder.lastSyncedAt) {
      this.mostRecentSyncTimestamp = folder.lastSyncedAt;
      this.updateLastSyncedUI();
    }
  },

  updateLastSyncedUI: function() {
    if (this.mostRecentSyncTimestamp) {
      this.lastSyncedAtNode.dataset.time =
        this.mostRecentSyncTimestamp.valueOf();
      this.lastSyncedAtNode.dataset.compactFormat = true;
      this.lastSyncedAtNode.textContent =
        common.prettyDate(this.mostRecentSyncTimestamp, true);
    }
    else {
      this.lastSyncedAtNode.textContent = mozL10n.get('account-never-synced');
    }
  },

  updateSelfDom: function(isAccount) {
    var str = isAccount ? navigator.mozL10n.get('settings-account-section') :
      this.curAccount.name;
    this.domNode.getElementsByClassName('fld-folders-header-account-label')[0]
      .textContent = str;

    // Update account problem status
    if (this.curAccount.problems.length)
      this.toolbarAccountProblemNode.classList.remove('collapsed');
    else
      this.toolbarAccountProblemNode.classList.add('collapsed');
  },

  updateFolderDom: function(folder, firstTime) {
    var folderNode = folder.element;

    if (firstTime) {
      if (!folder.selectable)
        folderNode.classList.add('fld-folder-unselectable');

      var depthIdx = Math.min(FOLDER_DEPTH_CLASSES.length - 1, folder.depth);
      folderNode.classList.add(FOLDER_DEPTH_CLASSES[depthIdx]);

      folderNode.getElementsByClassName('fld-folder-name')[0]
        .textContent = folder.name;
    }

    if (folder === this.curFolder)
      folderNode.classList.add('fld-folder-selected');
    else
      folderNode.classList.remove('fld-folder-selected');

    // XXX do the unread count stuff once we have that info
  },

  onClickFolder: function(folderNode, event) {
    var folder = folderNode.folder;
    if (!folder.selectable)
      return;

    var oldFolder = this.curFolder;
    this.curFolder = folder;
    this.updateFolderDom(oldFolder);
    this.updateFolderDom(folder);

    this._showFolder(folder);
    Cards.moveToCard(['message_list', 'nonsearch']);
  },

  /**
   * Tell the message-list to show this folder; exists for single code path.
   */
  _showFolder: function(folder) {
    Cards.tellCard(['message_list', 'nonsearch'], { folder: folder });
  },

  /**
   * Our card is going away; perform all cleanup except destroying our DOM.
   * This will enable the UI to animate away from our card without weird
   * graphical glitches.
   */
  die: function() {
  }
};
Cards.defineCard({
  name: 'folder_picker',
  modes: {
    // Navigation mode acts like a tray
    navigation: {
      tray: true
    },
    movetarget: {
      tray: false
    }
  },
  constructor: FolderPickerCard,
  templateNode: templateNode
});

return FolderPickerCard;
});
