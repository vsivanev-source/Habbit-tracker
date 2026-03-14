// Firebase configuration and initialization
const firebaseConfig = {
  apiKey: "AIzaSyCnyVT-roP4X1jFlmMBr9NtPiEMnV8Ajys",
  authDomain: "habbit-tracker-9a956.firebaseapp.com",
  projectId: "habbit-tracker-9a956",
  storageBucket: "habbit-tracker-9a956.firebasestorage.app",
  messagingSenderId: "946002828024",
  appId: "1:946002828024:web:464339b5b3e3b1b53e790d"
};

firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db = firebase.firestore();

// Enable offline persistence for PWA
db.enablePersistence({ synchronizeTabs: true }).catch(err => {
  if (err.code === 'failed-precondition') {
    console.log('Firestore persistence: multiple tabs open');
  } else if (err.code === 'unimplemented') {
    console.log('Firestore persistence: not supported');
  }
});
