package keychain

import (
    "encoding/json"
    "fmt"
    "os"
)

const sessionFile = "/tmp/ipatool-session.json"

func SetItem(key, value string) error {
    data := map[string]string{}
    if raw, err := os.ReadFile(sessionFile); err == nil {
        json.Unmarshal(raw, &data)
    }
    data[key] = value
    raw, _ := json.Marshal(data)
    return os.WriteFile(sessionFile, raw, 0600)
}

func GetItem(key string) (string, error) {
    data := map[string]string{}
    if raw, err := os.ReadFile(sessionFile); err == nil {
        json.Unmarshal(raw, &data)
    }
    if v, ok := data[key]; ok {
        return v, nil
    }
    return "", fmt.Errorf("not found")
}

func RemoveItem(key string) error {
    data := map[string]string{}
    if raw, err := os.ReadFile(sessionFile); err == nil {
        json.Unmarshal(raw, &data)
    }
    delete(data, key)
    raw, _ := json.Marshal(data)
    return os.WriteFile(sessionFile, raw, 0600)
}