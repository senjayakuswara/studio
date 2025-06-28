
"use client"

import {
  getAuth,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  updatePassword,
  EmailAuthProvider,
  reauthenticateWithCredential,
  updateProfile,
  type User
} from "firebase/auth";
import { app } from "./firebase";

const auth = getAuth(app);

export const signInWithEmail = (email: string, password: string) => {
  return signInWithEmailAndPassword(auth, email, password);
};

export const signOut = () => {
  return firebaseSignOut(auth);
};

export const onAuthChange = (callback: (user: User | null) => void) => {
  return onAuthStateChanged(auth, callback);
};

export const updateUserProfile = (displayName: string) => {
  const user = auth.currentUser;
  if (!user) throw new Error("No user is currently signed in.");
  return updateProfile(user, { displayName });
};

export const changeUserPassword = async (currentPassword: string, newPassword: string) => {
  const user = auth.currentUser;
  if (!user || !user.email) throw new Error("No user is currently signed in or user has no email.");

  const credential = EmailAuthProvider.credential(user.email, currentPassword);
  
  // Re-authenticate the user
  await reauthenticateWithCredential(user, credential);
  
  // Update the password
  await updatePassword(user, newPassword);
};
